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

const CANAL_TRANSCRIPT_ID = '1463408206129664128';
const CANAL_RELATORIO_ID = '1458342162981716039';

const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
function log(msg) {
  console.log(msg);
  try {
    fs.appendFileSync(path.join(logsDir, 'bot.log'), `[${new Date().toLocaleString()}] ${msg}\n`, 'utf8');
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

/* ================= ESTADO ================= */
// PRESENÇA
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;
const fluxoPresenca = new Map();

// TICKETS
const ticketsAbertos = new Map(); // ownerId -> channelId

/* ================= HELPERS ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ackUpdate(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  } catch {}
}

async function toast(interaction, content, ms = 4000) {
  try {
    const msg = await interaction.followUp({ content, flags: 64 }).catch(() => null);
    if (msg?.id) setTimeout(() => interaction.webhook?.deleteMessage(msg.id).catch(() => {}), ms);
  } catch {}
}

async function fetchChannelSafe(guild, channelId) {
  try {
    return await guild.channels.fetch(channelId);
  } catch (e) {
    if (e?.code === 10003) return null; // Unknown Channel OR no access
    throw e;
  }
}

async function renameWithVerify(guild, channel, targetName, suffixToCheck) {
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try { await channel.setName(targetName); }
    catch (e) { lastErr = e; }

    await sleep(900);

    const fresh = await fetchChannelSafe(guild, channel.id);
    if (!fresh) return { ok: false, err: { code: 10003, message: 'Unknown Channel' } };
    if ((fresh.name || '').toLowerCase().endsWith(suffixToCheck)) return { ok: true, err: null };
  }
  return { ok: false, err: lastErr };
}

function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const m = topic.match(/ticket-owner:(\d+)/);
  return m ? m[1] : null;
}

function ticketBaseName(name) {
  return (name || '').replace(/-aberto$/i, '').replace(/-fechado$/i, '').replace(/-edicao$/i, '');
}
function setTicketName(name, status) {
  return `${ticketBaseName(name)}-${status}`;
}
function getTicketStatusFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('-fechado')) return 'fechado';
  if (n.endsWith('-edicao')) return 'edicao';
  return 'aberto';
}

/* ================= UI ================= */
function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar ticket').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_editar').setLabel('✏️ Editar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger),
  );
}

function buildPainelPresencaPayload() {
  const linhas = telefones.map(t => {
    const st = estadoTelefones[t] || 'Livre';
    const bolinha = (st.toLowerCase().includes('bina') || st.toLowerCase().includes('ocup') || st.includes('<@')) ? '🔴' : '🟢';
    return `${bolinha} ${t} — ${st}`;
  }).join('\n');

  const rowTelefones = new ActionRowBuilder().addComponents(
    ...telefones.map(t =>
      new ButtonBuilder()
        .setCustomId(`presenca_tel_${t}`)
        .setLabel(`📞 ${t}`)
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

function menuTelefones(customId, { apenasOcupados = false, placeholder = 'Selecione um telefone' } = {}) {
  const options = telefones
    .filter(t => !apenasOcupados || ((estadoTelefones[t] || 'Livre') !== 'Livre'))
    .map(t => ({
      label: t,
      value: t,
      description: `Status: ${estadoTelefones[t] || 'Livre'}`.slice(0, 100),
    }));

  const safeOptions = options.length
    ? options
    : [{ label: 'Nenhum disponível', value: '__none__', description: 'Não há telefones para selecionar.' }];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(safeOptions).setMinValues(1).setMaxValues(1)
  );
}

function menuUsuario(customId, placeholder = 'Selecione o membro') {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)
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

/* ================= READY ================= */
client.once('clientReady', async () => {
  log('✅ Bot online');
  await upsertPainelAbrirTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;

    const cid = interaction.customId;
    log(`[CLICK] customId=${cid} channel=${interaction.channelId} user=${interaction.user?.id}`);

    /* ================= PRESENÇA ================= */
    if (interaction.isButton() && cid.startsWith('presenca_')) {
      await interaction.deferUpdate().catch(() => {});

      if (cid.startsWith('presenca_tel_')) {
        const tel = cid.replace('presenca_tel_', '');
        if (estadoTelefones[tel] != null) {
          estadoTelefones[tel] = (estadoTelefones[tel] === 'Livre') ? 'binabot' : 'Livre';
        }
        await upsertPainelPresenca();
        await toast(interaction, `📞 ${tel}: ${estadoTelefones[tel] || 'Livre'}`, 2500);
        return;
      }

      if (cid === 'presenca_desconectar_todos') {
        for (const t of telefones) estadoTelefones[t] = 'Livre';
        await upsertPainelPresenca();
        await toast(interaction, '🔴 Desconectado de todos.', 2500);
        return;
      }

      if (cid === 'presenca_desconectar_um') {
        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🟠 <@${interaction.user.id}>, selecione o telefone para desconectar:`,
          components: [menuTelefones('presenca_desconectar_um_select', { apenasOcupados: true })],
        }, 20000);
        return;
      }

      if (cid === 'presenca_transferir') {
        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🔵 <@${interaction.user.id}>, selecione o telefone de origem:`,
          components: [menuTelefones('presenca_transferir_tel_select', { apenasOcupados: true })],
        }, 20000);
        return;
      }

      if (cid === 'presenca_forcar') {
        await enviarMsgTempNoCanal(interaction.channel, {
          content: `⚠️ <@${interaction.user.id}>, selecione o telefone para forçar:`,
          components: [menuTelefones('presenca_forcar_select', { apenasOcupados: true })],
        }, 20000);
        return;
      }
    }

    if (interaction.isStringSelectMenu() && cid === 'presenca_desconectar_um_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (tel && tel !== '__none__') estadoTelefones[tel] = 'Livre';
      await upsertPainelPresenca();
      interaction.message.delete().catch(() => {});
      await toast(interaction, `✅ ${tel} desconectado.`, 2500);
      return;
    }

    if (interaction.isStringSelectMenu() && cid === 'presenca_transferir_tel_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      interaction.message.delete().catch(() => {});
      if (!tel || tel === '__none__') return;

      await enviarMsgTempNoCanal(interaction.channel, {
        content: `🔵 <@${interaction.user.id}>, selecione o membro para receber **${tel}**:`,
        components: [menuUsuario(`presenca_transferir_user_select:${tel}`)],
      }, 20000);
      return;
    }

    if (interaction.isUserSelectMenu() && cid.startsWith('presenca_transferir_user_select:')) {
      await interaction.deferUpdate().catch(() => {});
      const tel = cid.split(':')[1];
      const userId = interaction.values?.[0];
      interaction.message.delete().catch(() => {});
      if (tel && userId) estadoTelefones[tel] = `<@${userId}>`;
      await upsertPainelPresenca();
      await toast(interaction, `✅ ${tel} transferido para <@${userId}>.`, 3000);
      return;
    }

    if (interaction.isStringSelectMenu() && cid === 'presenca_forcar_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (tel && tel !== '__none__') estadoTelefones[tel] = 'Livre';
      await upsertPainelPresenca();
      interaction.message.delete().catch(() => {});
      await toast(interaction, `⚠️ Forçado: ${tel} desconectado.`, 3000);
      return;
    }

    /* ================= TICKETS ================= */
    if (interaction.isButton() && cid === 'abrir_ticket') {
      await ackUpdate(interaction);

      try {
        const userId = interaction.user.id;

        const existenteId = ticketsAbertos.get(userId);
        if (existenteId) {
          const cached = interaction.guild.channels.cache.get(existenteId);
          if (cached) return toast(interaction, `⚠️ Você já tem um ticket: ${cached}`, 4500);
          ticketsAbertos.delete(userId);
        }

        const canal = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}-aberto`,
          type: ChannelType.GuildText,
          parent: CATEGORIA_TICKET_ID,
          permissionOverwrites: [
            // ✅ bot explicitamente
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          ],
        });

        await canal.setTopic(`ticket-owner:${userId}`).catch(() => {});
        ticketsAbertos.set(userId, canal.id);

        await canal.send({ content: `🎫 Ticket de <@${userId}>`, components: [rowTicket()] });
        return toast(interaction, `✅ Ticket criado: ${canal}`, 4500);
      } catch (err) {
        log(`❌ abrir_ticket error: ${err?.message || err}`);
        return toast(interaction, '⚠️ Erro ao criar o ticket.', 4500);
      }
    }

    // Ações dentro de ticket
    if (interaction.isButton() && cid.startsWith('ticket_')) {
      await ackUpdate(interaction);

      const ch = await fetchChannelSafe(interaction.guild, interaction.channelId);
      if (!ch) return toast(interaction, '⚠️ Este ticket não existe mais (ou o bot não tem acesso).', 8000);

      const ownerId = getTicketOwnerIdFromChannel(ch);
      if (!ownerId) return toast(interaction, '⚠️ Não encontrei o dono do ticket (topic).', 6000);

      // FECHAR: dono ou staff
      if (cid === 'ticket_fechar') {
        const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
        if (!autorizado) return toast(interaction, '🚫 Apenas o dono ou staff pode FECHAR.', 6000);

        try {
          await ch.permissionOverwrites.edit(ownerId, { SendMessages: false });
          const alvo = setTicketName(ch.name, 'fechado');
          const res = await renameWithVerify(interaction.guild, ch, alvo, '-fechado');
          if (!res.ok) {
            log(`❌ Falha renomeando para fechado: ${res.err?.message || res.err}`);
            return toast(interaction, '⚠️ Não consegui renomear para -fechado. Tente novamente.', 9000);
          }
          return toast(interaction, '🔒 Ticket fechado.', 3500);
        } catch (err) {
          log(`❌ ticket_fechar error: ${err?.message || err}`);
          return toast(interaction, '⚠️ Erro ao fechar o ticket.', 8000);
        }
      }

      // EDITAR: somente staff, somente se fechado
      if (cid === 'ticket_editar') {
        if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode EDITAR.', 6000);

        const status = getTicketStatusFromName(ch.name);
        if (status !== 'fechado') return toast(interaction, 'ℹ️ Para editar, o ticket precisa estar FECHADO.', 6000);

        try {
          await ch.permissionOverwrites.edit(ownerId, { SendMessages: true });
          const alvo = setTicketName(ch.name, 'edicao');
          const res = await renameWithVerify(interaction.guild, ch, alvo, '-edicao');
          if (!res.ok) {
            log(`❌ Falha renomeando para edição: ${res.err?.message || res.err}`);
            await ch.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => {});
            return toast(interaction, '⚠️ Não consegui mudar para -edicao. Aguarde 30–60s e tente novamente.', 10000);
          }
          return toast(interaction, '✏️ Ticket em EDIÇÃO (dono liberado).', 7000);
        } catch (err) {
          log(`❌ ticket_editar error: ${err?.message || err}`);
          return toast(interaction, '⚠️ Erro ao colocar ticket em edição.', 8000);
        }
      }

      // EXCLUIR: dono ou staff
      if (cid === 'ticket_excluir') {
        const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
        if (!autorizado) return toast(interaction, '🚫 Apenas o dono ou staff pode EXCLUIR.', 6000);

        ticketsAbertos.delete(ownerId);
        await toast(interaction, '🗑 Ticket será apagado em 2s...', 2500);
        setTimeout(() => ch.delete().catch(() => {}), 2000);
        return;
      }

      // SALVAR: somente staff e somente se fechado
      if (cid === 'ticket_salvar') {
        if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode SALVAR.', 6000);

        const status = getTicketStatusFromName(ch.name);
        if (status !== 'fechado') return toast(interaction, 'ℹ️ Para salvar, feche o ticket primeiro.', 6000);

        try {
          const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
          if (!msgs) return toast(interaction, '⚠️ Não consegui buscar mensagens.', 7000);

          const arr = msgs.reverse().toJSON();
          const transcript = arr.map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || ''}`).join('\n');

          const participantes = Array.from(new Set(arr.map(m => m.author.tag))).slice(0, 15);
          const primeirasLinhas = arr.slice(0, 6).map(m => `${m.author.username}: ${(m.content || '(sem texto)').replace(/\s+/g, ' ').slice(0, 120)}`);

          const resumo = [
            `🧾 **Resumo do Ticket**`,
            `• Canal: **${ch.name}**`,
            `• Criado em: **${ch.createdAt?.toLocaleString?.() || new Date().toLocaleString()}**`,
            `• Total de mensagens (últimas 100): **${arr.length}**`,
            `• Participantes:`,
            ...(participantes.length ? participantes.map(p => `- ${p}`) : ['- (sem participantes)']),
            ``,
            `📌 **Prévia:**`,
            ...(primeirasLinhas.length ? primeirasLinhas.map(l => `> ${l}`) : ['> (sem mensagens)']),
          ].join('\n');

          const safeResumo = resumo.length > 1900 ? (resumo.slice(0, 1900) + '\n...(truncado)') : resumo;

          const canalRelatorio = await client.channels.fetch(CANAL_RELATORIO_ID).catch(() => null);
          if (canalRelatorio?.isTextBased()) await canalRelatorio.send({ content: safeResumo }).catch(() => {});

          const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
          if (canalTranscript?.isTextBased()) await canalTranscript.send({ content: safeResumo }).catch(() => {});

          const user = await client.users.fetch(ownerId).catch(() => null);
          if (user) {
            const buffer = Buffer.from(transcript || 'Sem mensagens', 'utf8');
            await user.send({
              content: `📄 Seu ticket foi salvo.\n\n${safeResumo}`,
              files: [{ attachment: buffer, name: `transcript-${ch.name}.txt` }],
            }).catch(() => {});
          }

          ticketsAbertos.delete(ownerId);

          await toast(interaction, '💾 Ticket salvo. Canal será apagado.', 3500);
          setTimeout(() => ch.delete().catch(() => {}), 2500);
          return;

        } catch (err) {
          log(`❌ ticket_salvar error: ${err?.message || err}`);
          return toast(interaction, '⚠️ Erro ao salvar o ticket.', 8000);
        }
      }
    }
  } catch (err) {
    log(`❌ interactionCreate fatal: ${err?.message || err}`);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HARDEN PROCESS ================= */
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => log(`🌐 HTTP na porta ${PORT}`));
