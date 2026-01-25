require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';

const CANAL_RELATORIO_ID = '1458342162981716039';   // logs do painel de presença
const CANAL_TRANSCRIPT_ID = '1463408206129664128';  // salvar ticket só aqui

const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS LOCAL ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
function logLocal(msg) {
  console.log(msg);
  try {
    fs.appendFileSync(path.join(logsDir, 'bot.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {}
}

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* ================= ESTADO PRESENÇA ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
// Livre OU "<@id>"
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;

// Fluxo de menus (transferir etc.)
const fluxoPresenca = new Map(); // userId -> { action, tel? }

/* ================= ESTADO TICKETS ================= */
const ticketsAbertos = new Map(); // ownerId -> channelId

/* ================= UTIL ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}

function brTimeString(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

async function logCanalRelatorio(text) {
  try {
    const ch = await client.channels.fetch(CANAL_RELATORIO_ID).catch(() => null);
    if (ch?.isTextBased()) await ch.send({ content: text });
  } catch {}
}

async function ackUpdate(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  } catch {}
}

async function toast(interaction, content, ms = 3500) {
  try {
    const msg = await interaction.followUp({ content, flags: 64 }).catch(() => null);
    if (msg?.id) setTimeout(() => interaction.webhook?.deleteMessage(msg.id).catch(() => {}), ms);
  } catch {}
}

async function enviarMsgTempNoCanal(channel, payload, ttlMs = 20000) {
  const msg = await channel.send(payload).catch(() => null);
  if (!msg) return null;
  setTimeout(() => msg.delete().catch(() => {}), ttlMs);
  return msg;
}

/* ====== Ticket helpers ====== */
function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const m = topic.match(/ticket-owner:(\d+)/);
  return m ? m[1] : null;
}
function ticketBaseName(name) {
  return (name || '').replace(/-aberto$/i, '').replace(/-fechado$/i, '');
}
function setTicketName(name, status /* aberto|fechado */) {
  return `${ticketBaseName(name)}-${status}`;
}
function getTicketStatusFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('-fechado')) return 'fechado';
  return 'aberto';
}
async function fetchChannelSafe(guild, channelId) {
  try { return await guild.channels.fetch(channelId); }
  catch (e) { if (e?.code === 10003) return null; throw e; }
}
async function renameWithVerify(guild, channel, targetName, suffix) {
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try { await channel.setName(targetName); }
    catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 900));
    const fresh = await fetchChannelSafe(guild, channel.id);
    if (!fresh) return { ok: false, err: { code: 10003, message: 'Unknown Channel' } };
    if ((fresh.name || '').toLowerCase().endsWith(suffix)) return { ok: true };
  }
  return { ok: false, err: lastErr };
}

/* ================= UI ================= */
function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar ticket').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_abrir').setLabel('🔓 Abrir').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger),
  );
}

function buildPainelPresencaPayload() {
  const linhas = telefones.map(t => {
    const st = estadoTelefones[t] || 'Livre';
    const ocupado = st !== 'Livre';
    const bolinha = ocupado ? '🔴' : '🟢';
    const who = ocupado ? st : 'Livre';
    return `${bolinha} ${t} — ${who}`;
  }).join('\n');

  const rowTelefones = new ActionRowBuilder().addComponents(
    ...telefones.map(t =>
      new ButtonBuilder()
        .setCustomId(`presenca_tel_${t}`)
        .setLabel(`${t}`)
        .setStyle(ButtonStyle.Success)
    )
  );

  const rowAcoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('presenca_desconectar_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('presenca_desconectar_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('presenca_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('presenca_forcar').setLabel('⚠️ Forçar').setStyle(ButtonStyle.Secondary),
  );

  return { content: `📞 **PAINEL DE PRESENÇA**\n\n${linhas}`, components: [rowTelefones, rowAcoes] };
}

function menuTelefones(customId, list, placeholder = 'Selecione um telefone') {
  const options = (list || []).map(t => ({
    label: t,
    value: t,
    description: `Status: ${(estadoTelefones[t] || 'Livre')}`.slice(0, 100),
  }));

  const safeOptions = options.length
    ? options
    : [{ label: 'Nenhum disponível', value: '__none__', description: 'Nada para selecionar.' }];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(safeOptions)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function menuUsuario(customId, placeholder = 'Selecione o membro') {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

/* ================= UPSERT PAINÉIS ================= */
async function upsertPainelAbrirTicket() {
  const canal = await client.channels.fetch(CANAL_ABRIR_TICKET_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const payload = {
    content: '🎫 **ATENDIMENTO — ABRIR TICKET**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('abrir_ticket').setLabel('📂 Abrir Ticket').setStyle(ButtonStyle.Primary)
      ),
    ],
  };

  const msgs = await canal.messages.fetch({ limit: 25 }).catch(() => null);
  const existente = msgs?.find(m => m.author?.id === client.user.id && (m.content || '').includes('🎫 **ATENDIMENTO — ABRIR TICKET**'));
  if (existente) await existente.edit(payload).catch(() => {});
  else await canal.send(payload).catch(() => {});
}

async function upsertPainelPresenca() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const topic = canal.topic || '';
  const match = topic.match(/presenca-panel:(\d+)/);
  const topicMsgId = match ? match[1] : null;

  if (topicMsgId) {
    const msg = await canal.messages.fetch(topicMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      presencaPanelMsgId = msg.id;
      return;
    }
  }

  const msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
  const existente = msgs?.find(m => m.author?.id === client.user.id && (m.content || '').includes('📞 **PAINEL DE PRESENÇA**'));

  if (existente) {
    presencaPanelMsgId = existente.id;
    await existente.edit(buildPainelPresencaPayload()).catch(() => {});
    await canal.setTopic(`presenca-panel:${existente.id}`).catch(() => {});
    return;
  }

  const nova = await canal.send(buildPainelPresencaPayload()).catch(() => null);
  if (nova) {
    presencaPanelMsgId = nova.id;
    await canal.setTopic(`presenca-panel:${nova.id}`).catch(() => {});
  }
}

/* ================= READY (UMA VEZ) ================= */
client.once('clientReady', async () => {
  logLocal('✅ Bot online');
  await upsertPainelAbrirTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;

    logLocal(`[CLICK] customId=${interaction.customId} channel=${interaction.channelId} user=${interaction.user?.id}`);

    /* ================= PRESENÇA - BOTÕES ================= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_')) {
      await ackUpdate(interaction);

      // Botões telefones: toggle conectar/desconectar rápido
      if (interaction.customId.startsWith('presenca_tel_')) {
        const tel = interaction.customId.replace('presenca_tel_', '');
        const atual = estadoTelefones[tel];

        if (atual === 'Livre') {
          estadoTelefones[tel] = `<@${interaction.user.id}>`;
          await upsertPainelPresenca();
          await toast(interaction, `✅ Conectado: ${tel}`, 2500);
          await logCanalRelatorio(`📞 **PRESENÇA** | ${brTimeString()} | <@${interaction.user.id}> conectou em **${tel}**.`);
          return;
        }

        // se já é o próprio usuário, desconecta
        if (atual === `<@${interaction.user.id}>`) {
          estadoTelefones[tel] = 'Livre';
          await upsertPainelPresenca();
          await toast(interaction, `✅ Desconectado: ${tel}`, 2500);
          await logCanalRelatorio(`📞 **PRESENÇA** | ${brTimeString()} | <@${interaction.user.id}> desconectou de **${tel}**.`);
          return;
        }

        // ocupado por outro
        await toast(interaction, `⚠️ ${tel} já está com ${atual}.`, 3000);
        return;
      }

      if (interaction.customId === 'presenca_desconectar_todos') {
        const antes = Object.entries(estadoTelefones).filter(([_, v]) => v === `<@${interaction.user.id}>`).map(([k]) => k);
        for (const t of antes) estadoTelefones[t] = 'Livre';
        await upsertPainelPresenca();
        await toast(interaction, '🔴 Você foi desconectado de todos os telefones.', 3000);

        if (antes.length) {
          await logCanalRelatorio(`📞 **PRESENÇA** | ${brTimeString()} | <@${interaction.user.id}> desconectou de TODOS: ${antes.map(t => `**${t}**`).join(', ')}.`);
        }
        return;
      }

      // desconectar UM: menu com telefones do próprio usuário (ou, se staff, qualquer ocupado)
      if (interaction.customId === 'presenca_desconectar_um') {
        const minhaLista = Object.entries(estadoTelefones)
          .filter(([_, v]) => v === `<@${interaction.user.id}>`)
          .map(([k]) => k);

        const lista = (minhaLista.length || !isStaff(interaction.member))
          ? minhaLista
          : Object.entries(estadoTelefones).filter(([_, v]) => v !== 'Livre').map(([k]) => k);

        fluxoPresenca.set(interaction.user.id, { action: 'desconectar_um' });

        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🟠 <@${interaction.user.id}>, selecione o telefone para desconectar:`,
          components: [menuTelefones('presenca_desconectar_um_select', lista, 'Selecione o telefone')],
        }, 20000);

        return;
      }

      // transferir: escolher telefone (do próprio usuário; staff pode transferir qualquer ocupado)
      if (interaction.customId === 'presenca_transferir') {
        const minhaLista = Object.entries(estadoTelefones)
          .filter(([_, v]) => v === `<@${interaction.user.id}>`)
          .map(([k]) => k);

        const lista = (minhaLista.length || !isStaff(interaction.member))
          ? minhaLista
          : Object.entries(estadoTelefones).filter(([_, v]) => v !== 'Livre').map(([k]) => k);

        fluxoPresenca.set(interaction.user.id, { action: 'transferir_tel' });

        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🔵 <@${interaction.user.id}>, selecione o telefone para transferir:`,
          components: [menuTelefones('presenca_transferir_tel_select', lista, 'Selecione o telefone')],
        }, 20000);

        return;
      }

      // forçar: escolher qualquer telefone ocupado e desconectar (qualquer um pode)
      if (interaction.customId === 'presenca_forcar') {
        const ocupados = Object.entries(estadoTelefones).filter(([_, v]) => v !== 'Livre').map(([k]) => k);
        fluxoPresenca.set(interaction.user.id, { action: 'forcar' });

        await enviarMsgTempNoCanal(interaction.channel, {
          content: `⚠️ <@${interaction.user.id}>, selecione o telefone ocupado para **forçar desconexão**:`,
          components: [menuTelefones('presenca_forcar_select', ocupados, 'Selecione o telefone ocupado')],
        }, 20000);

        return;
      }
    }

    /* ================= PRESENÇA - SELECTS ================= */
    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_desconectar_um_select') {
      await ackUpdate(interaction);
      const tel = interaction.values?.[0];
      interaction.message.delete().catch(() => {});
      if (!tel || tel === '__none__') return;

      const atual = estadoTelefones[tel];
      const permitido = (atual === `<@${interaction.user.id}>`) || isStaff(interaction.member);
      if (!permitido) return toast(interaction, `🚫 Você não está conectado em ${tel}.`, 4000);

      estadoTelefones[tel] = 'Livre';
      await upsertPainelPresenca();
      await toast(interaction, `✅ Desconectado: ${tel}`, 2500);
      await logCanalRelatorio(`📞 **PRESENÇA** | ${brTimeString()} | <@${interaction.user.id}> desconectou (UM): **${tel}**.`);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_transferir_tel_select') {
      await ackUpdate(interaction);
      const tel = interaction.values?.[0];
      interaction.message.delete().catch(() => {});
      if (!tel || tel === '__none__') return;

      const atual = estadoTelefones[tel];
      const permitido = (atual === `<@${interaction.user.id}>`) || isStaff(interaction.member);
      if (!permitido) return toast(interaction, `🚫 Você não pode transferir ${tel}.`, 4500);

      fluxoPresenca.set(interaction.user.id, { action: 'transferir_user', tel });

      await enviarMsgTempNoCanal(interaction.channel, {
        content: `🔵 <@${interaction.user.id}>, selecione o membro que receberá **${tel}**:`,
        components: [menuUsuario('presenca_transferir_user_select')],
      }, 20000);

      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'presenca_transferir_user_select') {
      await ackUpdate(interaction);
      const userId = interaction.values?.[0];
      interaction.message.delete().catch(() => {});
      if (!userId) return;

      const flow = fluxoPresenca.get(interaction.user.id);
      const tel = flow?.tel;
      if (!tel) return toast(interaction, '⚠️ Fluxo expirou. Clique em Transferir novamente.', 5000);

      estadoTelefones[tel] = `<@${userId}>`;
      fluxoPresenca.delete(interaction.user.id);

      await upsertPainelPresenca();
      await toast(interaction, `✅ Transferido: ${tel} → <@${userId}>`, 3000);
      await logCanalRelatorio(`📞 **PRESENÇA** | ${brTimeString()} | <@${interaction.user.id}> transferiu **${tel}** para <@${userId}>.`);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_forcar_select') {
      await ackUpdate(interaction);
      const tel = interaction.values?.[0];
      interaction.message.delete().catch(() => {});
      if (!tel || tel === '__none__') return;

      const anterior = estadoTelefones[tel];
      estadoTelefones[tel] = 'Livre';

      await upsertPainelPresenca();
      await toast(interaction, `⚠️ Forçado: ${tel} desconectado.`, 3000);
      await logCanalRelatorio(`📞 **PRESENÇA** | ${brTimeString()} | <@${interaction.user.id}> forçou desconexão em **${tel}** (antes: ${anterior}).`);
      return;
    }

    /* ================= TICKETS ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await ackUpdate(interaction);

      const guild = interaction.guild;
      const userId = interaction.user.id;

      // evita duplicar ticket: tenta achar canal existente pelo topic na cache
      const existing = guild.channels.cache.find(c => c?.type === ChannelType.GuildText && (c.topic || '').includes(`ticket-owner:${userId}`));
      if (existing) return toast(interaction, `⚠️ Você já tem ticket: ${existing}`, 5000);

      const canal = await guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          // bot explícito
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
          // staff role
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          // dono
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          // everyone deny
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ],
      });

      await canal.setTopic(`ticket-owner:${userId}`).catch(() => {});
      ticketsAbertos.set(userId, canal.id);

      await canal.send({ content: `🎫 Ticket de <@${userId}>`, components: [rowTicket()] });
      return toast(interaction, `✅ Ticket criado: ${canal}`, 4500);
    }

    // Ações dentro do ticket
    if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
      await ackUpdate(interaction);

      const guild = interaction.guild;
      const ch = await fetchChannelSafe(guild, interaction.channelId);
      if (!ch) return toast(interaction, '⚠️ Não consegui acessar este canal (Discord retornou 10003).', 8000);

      const ownerId = getTicketOwnerIdFromChannel(ch);
      if (!ownerId) return toast(interaction, '⚠️ Ticket sem owner no topic.', 6000);

      // FECHAR: dono OU staff
      if (interaction.customId === 'ticket_fechar') {
        const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
        if (!autorizado) return toast(interaction, '🚫 Apenas dono ou staff pode fechar.', 5000);

        await ch.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => {});
        const alvo = setTicketName(ch.name, 'fechado');
        const res = await renameWithVerify(guild, ch, alvo, '-fechado');
        if (!res.ok) return toast(interaction, '⚠️ Não consegui renomear para -fechado.', 8000);

        return toast(interaction, '🔒 Ticket fechado.', 3500);
      }

      // ABRIR (reabrir): somente staff, fechado -> aberto
      if (interaction.customId === 'ticket_abrir') {
        if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode reabrir.', 5000);

        const status = getTicketStatusFromName(ch.name);
        if (status !== 'fechado') return toast(interaction, 'ℹ️ O ticket já está aberto.', 4000);

        await ch.permissionOverwrites.edit(ownerId, { SendMessages: true }).catch(() => {});
        const alvo = setTicketName(ch.name, 'aberto');
        const res = await renameWithVerify(guild, ch, alvo, '-aberto');
        if (!res.ok) return toast(interaction, '⚠️ Não consegui renomear para -aberto.', 8000);

        return toast(interaction, '🔓 Ticket reaberto.', 3500);
      }

      // EXCLUIR: dono OU staff
      if (interaction.customId === 'ticket_excluir') {
        const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
        if (!autorizado) return toast(interaction, '🚫 Apenas dono ou staff pode excluir.', 5000);

        ticketsAbertos.delete(ownerId);
        await toast(interaction, '🗑 Ticket será apagado em 2s...', 2000);
        setTimeout(() => ch.delete().catch(() => {}), 2000);
        return;
      }

      // SALVAR: somente staff e somente se fechado
      if (interaction.customId === 'ticket_salvar') {
        if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode salvar.', 5000);

        const status = getTicketStatusFromName(ch.name);
        if (status !== 'fechado') return toast(interaction, 'ℹ️ Feche o ticket antes de salvar.', 6000);

        const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
        if (!msgs) return toast(interaction, '⚠️ Não consegui buscar mensagens.', 6000);

        const arr = msgs.reverse().toJSON();
        const transcript = arr.map(m => `[${brTimeString(m.createdAt)}] ${m.author.tag}: ${m.content || ''}`).join('\n');

        const participantes = Array.from(new Set(arr.map(m => m.author.tag))).slice(0, 15);
        const primeirasLinhas = arr.slice(0, 6).map(m => `${m.author.username}: ${(m.content || '(sem texto)').replace(/\s+/g, ' ').slice(0, 120)}`);

        const resumo = [
          `🧾 **Resumo do Ticket**`,
          `• Canal: **${ch.name}**`,
          `• Data: **${brTimeString()}**`,
          `• Mensagens (últimas 100): **${arr.length}**`,
          `• Participantes:`,
          ...(participantes.length ? participantes.map(p => `- ${p}`) : ['- (sem participantes)']),
          ``,
          `📌 **Prévia:**`,
          ...(primeirasLinhas.length ? primeirasLinhas.map(l => `> ${l}`) : ['> (sem mensagens)']),
        ].join('\n');

        const safeResumo = resumo.length > 1900 ? (resumo.slice(0, 1900) + '\n...(truncado)') : resumo;

        const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
        if (canalTranscript?.isTextBased()) await canalTranscript.send({ content: safeResumo }).catch(() => {});

        const dono = await client.users.fetch(ownerId).catch(() => null);
        if (dono) {
          const buffer = Buffer.from(transcript || 'Sem mensagens', 'utf8');
          await dono.send({
            content: `📄 Seu ticket foi salvo.\n\n${safeResumo}`,
            files: [{ attachment: buffer, name: `transcript-${ch.name}.txt` }],
          }).catch(() => {});
        }

        ticketsAbertos.delete(ownerId);
        await toast(interaction, '💾 Ticket salvo. Canal será apagado.', 3500);
        setTimeout(() => ch.delete().catch(() => {}), 2500);
        return;
      }
    }

  } catch (err) {
    logLocal(`❌ interactionCreate fatal: ${err?.message || err}`);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => logLocal(`🌐 HTTP na porta ${PORT}`));
