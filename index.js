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

const CATEGORIA_TICKETS_ABERTOS = '1465107475286982729';
const CATEGORIA_TICKETS_FECHADOS = '1465107523446116427';

const CANAL_RELATORIO_ID = '1458342162981716039';   // relatório diário da presença (1 msg/dia, editável)
const CANAL_TRANSCRIPT_ID = '1463408206129664128';  // salvar ticket só aqui

const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS LOCAL ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
function logLocal(msg) {
  console.log(msg);
  try { fs.appendFileSync(path.join(logsDir, 'bot.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8'); } catch {}
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
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;
const fluxoPresenca = new Map();

/* ================= ESTADO TICKETS ================= */
const ticketsAbertos = new Map(); // ownerId -> channelId
const ticketLocks = new Map();    // channelId -> timeoutHandle

/* ================= UTIL ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function brTimeString(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}
function brDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
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

/* ================= LOCK TICKETS (com timeout) ================= */
function acquireLock(channelId, ttlMs = 15000) {
  if (ticketLocks.has(channelId)) return false;

  const handle = setTimeout(() => {
    ticketLocks.delete(channelId);
    logLocal(`⚠️ Lock expirou automaticamente: channel=${channelId}`);
  }, ttlMs);

  ticketLocks.set(channelId, handle);
  return true;
}
function releaseLock(channelId) {
  const handle = ticketLocks.get(channelId);
  if (handle) clearTimeout(handle);
  ticketLocks.delete(channelId);
}

/* ================= RELATÓRIO DIÁRIO PRESENÇA ================= */
async function appendDailyLog(line) {
  try {
    const canal = await client.channels.fetch(CANAL_RELATORIO_ID).catch(() => null);
    if (!canal || !canal.isTextBased()) return;

    const dateKey = brDateKey(new Date());
    const header = `📅 **RELATÓRIO PRESENÇA — ${dateKey}**`;
    const marker = `RELATORIO_PRESENCA:${dateKey}`;

    const msgs = await canal.messages.fetch({ limit: 30 }).catch(() => null);
    let target = msgs?.find(m => m.author?.id === client.user.id && (m.content || '').includes(marker));

    const newLine = `• ${brTimeString(new Date())} — ${line}`;

    if (!target) {
      await canal.send({ content: `${header}\n${marker}\n\n${newLine}` });
      return;
    }

    const current = target.content || '';
    const parts = current.split('\n');
    const base = parts.slice(0, 3).join('\n');
    const body = parts.slice(3).join('\n').trim();

    const linhas = body ? body.split('\n') : [];
    linhas.push(newLine);

    while ((base + '\n' + linhas.join('\n')).length > 1800 && linhas.length > 1) linhas.shift();

    await target.edit({ content: `${base}\n${linhas.join('\n')}`.trimEnd() }).catch(() => {});
  } catch (e) {
    logLocal(`❌ appendDailyLog error: ${e?.message || e}`);
  }
}

/* ================= TICKET HELPERS ================= */
function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const m = topic.match(/ticket-owner:(\d+)/);
  return m ? m[1] : null;
}

async function fetchChannelSafe(guild, channelId) {
  try { return await guild.channels.fetch(channelId); }
  catch (e) { if (e?.code === 10003) return null; throw e; }
}

async function setTicketStateOnTopic(channel, state /* aberto|fechado */) {
  const topic = channel.topic || '';
  const cleaned = topic.replace(/ticket-state:(aberto|fechado)/g, '').trim();
  const newTopic = `${cleaned} ticket-state:${state}`.trim();
  await channel.setTopic(newTopic).catch(() => {});
}

function getTicketStateFromTopic(channel) {
  const topic = channel?.topic || '';
  const m = topic.match(/ticket-state:(aberto|fechado)/);
  return m ? m[1] : null;
}

/* ================= UI ================= */
function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_abrir').setLabel('🔓 Abrir').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger),
  );
}

/* ================= PRESENÇA UI ================= */
function buildPainelPresencaPayload() {
  const linhas = telefones.map(t => {
    const st = estadoTelefones[t] || 'Livre';
    const ocupado = st !== 'Livre';
    const bolinha = ocupado ? '🔴' : '🟢';
    return `${bolinha} ${t} — ${ocupado ? st : 'Livre'}`;
  }).join('\n');

  const rowTelefones = new ActionRowBuilder().addComponents(
    ...telefones.map(t =>
      new ButtonBuilder().setCustomId(`presenca_tel_${t}`).setLabel(`${t}`).setStyle(ButtonStyle.Success)
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
  const safeOptions = options.length ? options : [{ label: 'Nenhum disponível', value: '__none__', description: 'Nada para selecionar.' }];

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
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('abrir_ticket').setLabel('📂 Abrir Ticket').setStyle(ButtonStyle.Primary)
    )],
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
  logLocal('✅ Bot online');
  await upsertPainelAbrirTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;
    logLocal(`[CLICK] customId=${interaction.customId} channel=${interaction.channelId} user=${interaction.user?.id}`);

    /* ================= PRESENÇA ================= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_')) {
      await ackUpdate(interaction);

      if (interaction.customId.startsWith('presenca_tel_')) {
        const tel = interaction.customId.replace('presenca_tel_', '');
        const atual = estadoTelefones[tel];

        if (atual === 'Livre') {
          estadoTelefones[tel] = `<@${interaction.user.id}>`;
          await upsertPainelPresenca();
          await toast(interaction, `✅ Conectado: ${tel}`, 2500);
          await appendDailyLog(`<@${interaction.user.id}> conectou em **${tel}**.`);
          return;
        }

        if (atual === `<@${interaction.user.id}>`) {
          estadoTelefones[tel] = 'Livre';
          await upsertPainelPresenca();
          await toast(interaction, `✅ Desconectado: ${tel}`, 2500);
          await appendDailyLog(`<@${interaction.user.id}> desconectou de **${tel}**.`);
          return;
        }

        await toast(interaction, `⚠️ ${tel} já está com ${atual}.`, 3000);
        return;
      }

      if (interaction.customId === 'presenca_desconectar_todos') {
        const antes = Object.entries(estadoTelefones).filter(([_, v]) => v === `<@${interaction.user.id}>`).map(([k]) => k);
        for (const t of antes) estadoTelefones[t] = 'Livre';
        await upsertPainelPresenca();
        await toast(interaction, '🔴 Você foi desconectado de todos.', 3000);
        if (antes.length) await appendDailyLog(`<@${interaction.user.id}> desconectou de TODOS: ${antes.map(t => `**${t}**`).join(', ')}.`);
        return;
      }

      if (interaction.customId === 'presenca_desconectar_um') {
        const minhaLista = Object.entries(estadoTelefones).filter(([_, v]) => v === `<@${interaction.user.id}>`).map(([k]) => k);
        const lista = (minhaLista.length || !isStaff(interaction.member))
          ? minhaLista
          : Object.entries(estadoTelefones).filter(([_, v]) => v !== 'Livre').map(([k]) => k);

        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🟠 <@${interaction.user.id}>, selecione o telefone para desconectar:`,
          components: [menuTelefones('presenca_desconectar_um_select', lista)],
        }, 20000);
        return;
      }

      if (interaction.customId === 'presenca_transferir') {
        const minhaLista = Object.entries(estadoTelefones).filter(([_, v]) => v === `<@${interaction.user.id}>`).map(([k]) => k);
        const lista = (minhaLista.length || !isStaff(interaction.member))
          ? minhaLista
          : Object.entries(estadoTelefones).filter(([_, v]) => v !== 'Livre').map(([k]) => k);

        fluxoPresenca.set(interaction.user.id, { action: 'transferir_tel' });

        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🔵 <@${interaction.user.id}>, selecione o telefone para transferir:`,
          components: [menuTelefones('presenca_transferir_tel_select', lista)],
        }, 20000);
        return;
      }

      if (interaction.customId === 'presenca_forcar') {
        const ocupados = Object.entries(estadoTelefones).filter(([_, v]) => v !== 'Livre').map(([k]) => k);

        await enviarMsgTempNoCanal(interaction.channel, {
          content: `⚠️ <@${interaction.user.id}>, selecione o telefone para **forçar desconexão**:`,
          components: [menuTelefones('presenca_forcar_select', ocupados)],
        }, 20000);
        return;
      }
    }

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
      await appendDailyLog(`<@${interaction.user.id}> desconectou (UM): **${tel}**.`);
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
      await appendDailyLog(`<@${interaction.user.id}> transferiu **${tel}** para <@${userId}>.`);
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
      await appendDailyLog(`<@${interaction.user.id}> forçou desconexão em **${tel}** (antes: ${anterior}).`);
      return;
    }

    /* ================= TICKETS ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await ackUpdate(interaction);

      const guild = interaction.guild;
      const userId = interaction.user.id;

      const existing = guild.channels.cache.find(
        c => c?.type === ChannelType.GuildText && (c.topic || '').includes(`ticket-owner:${userId}`)
      );
      if (existing) return toast(interaction, `⚠️ Você já tem ticket: ${existing}`, 5000);

      const canal = await guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKETS_ABERTOS,
        permissionOverwrites: [
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ],
      });

      await canal.setTopic(`ticket-owner:${userId} ticket-state:aberto`).catch(() => {});
      ticketsAbertos.set(userId, canal.id);

      await canal.send({ content: `🎫 Ticket de <@${userId}>`, components: [rowTicket()] });
      return toast(interaction, `✅ Ticket criado: ${canal}`, 4500);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
      await ackUpdate(interaction);

      const guild = interaction.guild;
      const channelId = interaction.channelId;

      if (!acquireLock(channelId)) {
        return toast(interaction, '⏳ Aguarde… Estou processando este ticket.', 2500);
      }

      try {
        const ch = await fetchChannelSafe(guild, channelId);
        if (!ch) return toast(interaction, '⚠️ Não consegui acessar o canal (10003).', 9000);

        const ownerId = getTicketOwnerIdFromChannel(ch);
        if (!ownerId) return toast(interaction, '⚠️ Ticket sem owner no topic.', 7000);

        const stateTopic = getTicketStateFromTopic(ch);
        const effectiveState = stateTopic || 'aberto';

        if (interaction.customId === 'ticket_fechar') {
          const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
          if (!autorizado) return toast(interaction, '🚫 Apenas dono ou staff pode fechar.', 5000);

          logLocal(`ticket_fechar start canal=${ch.id} nome=${ch.name}`);

          await ch.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch((e) => {
            logLocal(`❌ ticket_fechar overwrite erro: ${e?.message || e}`);
          });

          await setTicketStateOnTopic(ch, 'fechado');

          // move para categoria FECHADOS (força refresh)
          await ch.setParent(CATEGORIA_TICKETS_FECHADOS).catch((e) => {
            logLocal(`❌ ticket_fechar setParent erro: ${e?.message || e}`);
          });

          logLocal(`ticket_fechar ok canal=${ch.id} -> categoria fechados`);
          return toast(interaction, '🔒 Ticket fechado.', 3500);
        }

        if (interaction.customId === 'ticket_abrir') {
          if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode reabrir.', 5000);

          if (effectiveState !== 'fechado') return toast(interaction, 'ℹ️ O ticket já está aberto.', 4000);

          logLocal(`ticket_abrir start canal=${ch.id} nome=${ch.name}`);

          await ch.permissionOverwrites.edit(ownerId, { SendMessages: true }).catch((e) => {
            logLocal(`❌ ticket_abrir overwrite erro: ${e?.message || e}`);
          });

          await setTicketStateOnTopic(ch, 'aberto');

          // move para categoria ABERTOS (força refresh)
          await ch.setParent(CATEGORIA_TICKETS_ABERTOS).catch((e) => {
            logLocal(`❌ ticket_abrir setParent erro: ${e?.message || e}`);
          });

          logLocal(`ticket_abrir ok canal=${ch.id} -> categoria abertos`);
          return toast(interaction, '🔓 Ticket reaberto.', 3500);
        }

        if (interaction.customId === 'ticket_excluir') {
          const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
          if (!autorizado) return toast(interaction, '🚫 Apenas dono ou staff pode excluir.', 5000);

          ticketsAbertos.delete(ownerId);
          await toast(interaction, '🗑 Ticket será apagado em 2s...', 2000);
          setTimeout(() => ch.delete().catch(() => {}), 2000);
          return;
        }

        if (interaction.customId === 'ticket_salvar') {
          if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode salvar.', 5000);

          if (effectiveState !== 'fechado') return toast(interaction, 'ℹ️ Feche o ticket antes de salvar.', 6000);

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

      } finally {
        releaseLock(channelId);
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
