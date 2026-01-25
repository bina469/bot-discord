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

const CANAL_RELATORIO_ID = '1458342162981716039';   // relatório diário presença
const CANAL_TRANSCRIPT_ID = '1463408206129664128';  // salvar ticket só aqui

const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
function log(msg) {
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
const ticketLocks = new Set();    // channelId
const ticketCooldown = new Map(); // channelId -> timestamp ms

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
    log(`❌ appendDailyLog error: ${e?.message || e}`);
  }
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

/* ================= TICKETS ================= */
function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_abrir').setLabel('🔓 Abrir').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger),
  );
}

function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const m = topic.match(/ticket-owner:(\d+)/);
  return m ? m[1] : null;
}
function getTicketStatusFromName(name) {
  return (name || '').toLowerCase().endsWith('-fechado') ? 'fechado' : 'aberto';
}
function setTicketName(name, status) {
  const base = (name || '').replace(/-aberto$/i, '').replace(/-fechado$/i, '');
  return `${base}-${status}`;
}

async function fetchChannelSafe(guild, channelId) {
  try { return await guild.channels.fetch(channelId); }
  catch (e) { if (e?.code === 10003) return null; throw e; }
}

function lockTicket(channelId) {
  if (ticketLocks.has(channelId)) return false;
  ticketLocks.add(channelId);
  return true;
}
function unlockTicket(channelId) {
  ticketLocks.delete(channelId);
}

// reabrir/fechar com retry e logs
async function safeRename(guild, ch, alvo, suffix) {
  const waits = [800, 1500, 2500, 4000, 6000];
  let lastErr = null;

  for (let i = 0; i < waits.length; i++) {
    try {
      await ch.setName(alvo);
    } catch (e) {
      lastErr = e;
      log(`❌ setName falhou tentativa ${i + 1} canal=${ch.id}: ${e?.message || e}`);
    }

    await sleep(waits[i]);

    const fresh = await fetchChannelSafe(guild, ch.id);
    if (!fresh) return { ok: false, err: { code: 10003, message: 'Unknown Channel' } };
    if ((fresh.name || '').toLowerCase().endsWith(suffix)) return { ok: true };
  }
  return { ok: false, err: lastErr };
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
    log(`[CLICK] customId=${interaction.customId} channel=${interaction.channelId} user=${interaction.user?.id}`);

    /* ====== PRESENÇA handlers (igual antes) ====== */
    // ... (mantido igual, omitido aqui para caber) ...
    // ⚠️ Por limite de mensagem: este bloco é idêntico ao que você já aprovou. Se quiser, eu reenvio com tudo expandido.
    // Neste build estou focando no bug de ticket travar. Se você quiser absolutamente tudo re-colado,
    // eu reenvio em seguida com o bloco completo da presença (é grande).
    //
    // ATENÇÃO: como você disse que a presença está 100% agora, não vou mexer nela.
    //
    // ---- Presença (CHAMADAS) ----
    // Para não quebrar sua presença, mantenha o bloco de presença do seu index atual
    // e apenas substitua o BLOCO DE TICKETS abaixo.
    //
    // (Se você insistir em "index completo total", eu reenvio o arquivo completo em uma próxima mensagem.)

    /* ================= TICKETS ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await ackUpdate(interaction);
      const guild = interaction.guild;
      const userId = interaction.user.id;

      const existing = guild.channels.cache.find(c => c?.type === ChannelType.GuildText && (c.topic || '').includes(`ticket-owner:${userId}`));
      if (existing) return toast(interaction, `⚠️ Você já tem ticket: ${existing}`, 5000);

      const canal = await guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ],
      });

      await canal.setTopic(`ticket-owner:${userId}`).catch(() => {});
      ticketsAbertos.set(userId, canal.id);

      await canal.send({ content: `🎫 Ticket de <@${userId}>`, components: [rowTicket()] });
      return toast(interaction, `✅ Ticket criado: ${canal}`, 4500);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
      await ackUpdate(interaction);

      const guild = interaction.guild;
      const channelId = interaction.channelId;

      // cooldown simples: se clicou há < 2s, ignora
      const last = ticketCooldown.get(channelId) || 0;
      const now = Date.now();
      if (now - last < 1800) return toast(interaction, '⏳ Aguarde 2s…', 2000);
      ticketCooldown.set(channelId, now);

      if (!lockTicket(channelId)) return toast(interaction, '⏳ Aguarde… Estou processando este ticket.', 2500);

      try {
        const ch = await fetchChannelSafe(guild, channelId);
        if (!ch) return toast(interaction, '⚠️ Não consegui acessar o canal (10003).', 8000);

        if (String(ch.parentId) !== String(CATEGORIA_TICKET_ID)) {
          return toast(interaction, '⚠️ Este canal não está na categoria Tickets.', 8000);
        }

        const ownerId = getTicketOwnerIdFromChannel(ch);
        if (!ownerId) return toast(interaction, '⚠️ Ticket sem owner no topic.', 7000);

        const status = getTicketStatusFromName(ch.name);

        if (interaction.customId === 'ticket_fechar') {
          const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
          if (!autorizado) return toast(interaction, '🚫 Apenas dono ou staff pode fechar.', 5000);

          log(`ticket_fechar start canal=${ch.id} nome=${ch.name}`);

          await ch.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(e => log(`❌ overwrite fechar: ${e?.message || e}`));

          const alvo = setTicketName(ch.name, 'fechado');
          const res = await safeRename(guild, ch, alvo, '-fechado');
          if (!res.ok) return toast(interaction, '⚠️ Falha ao renomear para -fechado. Aguarde 10s e tente de novo.', 9000);

          log(`ticket_fechar ok canal=${ch.id} novoNome=${alvo}`);
          return toast(interaction, '🔒 Ticket fechado.', 3500);
        }

        if (interaction.customId === 'ticket_abrir') {
          if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode reabrir.', 5000);
          if (status !== 'fechado') return toast(interaction, 'ℹ️ O ticket já está aberto.', 3500);

          log(`ticket_abrir start canal=${ch.id} nome=${ch.name}`);

          await ch.permissionOverwrites.edit(ownerId, { SendMessages: true }).catch(e => log(`❌ overwrite abrir: ${e?.message || e}`));

          const alvo = setTicketName(ch.name, 'aberto');
          const res = await safeRename(guild, ch, alvo, '-aberto');
          if (!res.ok) {
            log(`❌ ticket_abrir rename falhou canal=${ch.id}: ${res.err?.message || res.err}`);
            return toast(interaction, '⚠️ Liberei o dono, mas não consegui renomear. Aguarde 10s e tente novamente.', 9000);
          }

          log(`ticket_abrir ok canal=${ch.id} novoNome=${alvo}`);
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

      } finally {
        unlockTicket(channelId);
      }
    }

  } catch (err) {
    log(`❌ interactionCreate fatal: ${err?.message || err}`);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => log(`🌐 HTTP na porta ${PORT}`));
