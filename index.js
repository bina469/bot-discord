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

/* ================= LOGS (Render-safe) ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
function logPainel(msg) {
  const logPath = path.join(logsDir, 'painel.log');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toLocaleString()}] ${msg}\n`, 'utf8');
  } catch (err) {
    console.error('❌ Erro ao escrever log do painel:', err);
  }
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
// Presença
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;

// Tickets
const ticketsAbertos = new Map(); // userId -> channelId

// Fluxos do painel de presença
const fluxoPresenca = new Map(); // userId -> { action, step, telefone? }

/* ================= HELPERS ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// encerra "pensando..." em botões/menus
async function ackUpdate(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }
  } catch {}
}

async function avisarEphemeralAutoDelete(interaction, content, ms = 3500) {
  try {
    const msg = await interaction.followUp({ content, flags: 64 }).catch(() => null);
    if (msg?.id) setTimeout(() => interaction.webhook?.deleteMessage(msg.id).catch(() => {}), ms);
  } catch {}
}

async function enviarMsgTempNoCanal(channel, payload, ms = 20000) {
  const msg = await channel.send(payload).catch(() => null);
  if (!msg) return null;
  setTimeout(() => msg.delete().catch(() => {}), ms);
  return msg;
}

function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const match = topic.match(/ticket-owner:(\d+)/);
  return match ? match[1] : null;
}

// status do ticket por nome
function ticketBaseName(name) {
  return (name || '')
    .replace(/-aberto$/i, '')
    .replace(/-fechado$/i, '')
    .replace(/-edicao$/i, '');
}
function setTicketName(name, status /* 'aberto'|'fechado'|'edicao' */) {
  return `${ticketBaseName(name)}-${status}`;
}
function getTicketStatusFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('-fechado')) return 'fechado';
  if (n.endsWith('-edicao')) return 'edicao';
  return 'aberto';
}

// fetch seguro do canal (evita Unknown Channel)
async function fetchChannelSafe(guild, channelId) {
  try {
    const ch = await guild.channels.fetch(channelId);
    return ch;
  } catch (e) {
    // DiscordAPIError[10003] Unknown Channel
    if (e?.code === 10003) return null;
    throw e;
  }
}

// rename robusto com retry+verify
async function renameWithVerify(guild, channel, targetName, suffixToCheck /* '-fechado' etc */) {
  let lastErr = null;

  for (let i = 0; i < 4; i++) {
    try {
      await channel.setName(targetName);
    } catch (e) {
      lastErr = e;
    }

    await sleep(900);

    const fresh = await fetchChannelSafe(guild, channel.id);
    if (!fresh) return { ok: false, err: { code: 10003, message: 'Unknown Channel' } };

    if ((fresh.name || '').toLowerCase().endsWith(suffixToCheck)) {
      return { ok: true, err: null };
    }
  }

  return { ok: false, err: lastErr };
}

/* ================= UI BUILDERS ================= */
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
    const bolinha =
      (st.toLowerCase().includes('bina') || st.toLowerCase().includes('ocup') || st.includes('<@'))
        ? '🔴'
        : '🟢';
    return `${bolinha} ${t} — ${st}`;
  }).join('\n');

  const rowTelefones = new ActionRowBuilder().addComponents(
    ...telefones.map(t =>
      new ButtonBuilder().setCustomId(`presenca_tel_${t}`).setLabel(`📞 ${t}`).setStyle(ButtonStyle.Success)
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
async function upsertPainelTicket() {
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
  const existente = msgs?.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes('🎫 **ATENDIMENTO — ABRIR TICKET**')
  );

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

  if (presencaPanelMsgId) {
    const msg = await canal.messages.fetch(presencaPanelMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      await canal.setTopic(`presenca-panel:${msg.id}`).catch(() => {});
      return;
    }
  }

  const msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
  const existente = msgs?.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes('📞 **PAINEL DE PRESENÇA**')
  );

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

async function reconstruirTickets() {
  ticketsAbertos.clear();
  const categoria = await client.channels.fetch(CATEGORIA_TICKET_ID).catch(() => null);
  if (!categoria || !categoria.children) return;

  for (const [, ch] of categoria.children.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    const ownerId = getTicketOwnerIdFromChannel(ch);
    if (ownerId) ticketsAbertos.set(ownerId, ch.id);
  }
}

/* ================= TRANSCRIPT ================= */
function buildResumoTicket({ channelName, createdAt, totalMsgs, participantes, primeirasLinhas }) {
  const parts = participantes.length ? participantes.map(p => `- ${p}`).join('\n') : '- (sem participantes)';
  const preview = primeirasLinhas.length ? primeirasLinhas.map(l => `> ${l}`).join('\n') : '> (sem mensagens)';
  return [
    `🧾 **Resumo do Ticket**`,
    `• Canal: **${channelName}**`,
    `• Criado em: **${createdAt}**`,
    `• Total de mensagens (últimas 100): **${totalMsgs}**`,
    `• Participantes:`,
    parts,
    ``,
    `📌 **Prévia (início do histórico):**`,
    preview,
  ].join('\n');
}

async function gerarTranscriptEResumo(channel) {
  const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!msgs) return null;

  const arr = msgs.reverse().toJSON();
  const transcript = arr.map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || ''}`).join('\n');

  const participantesSet = new Set(arr.map(m => m.author.tag));
  const participantes = Array.from(participantesSet).slice(0, 15);

  const primeirasLinhas = arr.slice(0, 6).map(m => `${m.author.username}: ${(m.content || '(sem texto)').replace(/\s+/g, ' ').slice(0, 120)}`);

  const resumo = buildResumoTicket({
    channelName: channel.name,
    createdAt: channel.createdAt?.toLocaleString?.() || new Date().toLocaleString(),
    totalMsgs: arr.length,
    participantes,
    primeirasLinhas,
  });

  return { transcript, resumo };
}

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log('✅ Bot online');
  await reconstruirTickets();
  await upsertPainelTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    /* ================= TICKETS ================= */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await ackUpdate(interaction);
      try {
        const userId = interaction.user.id;

        const canalIdExistente = ticketsAbertos.get(userId);
        if (canalIdExistente) {
          const ch = interaction.guild.channels.cache.get(canalIdExistente);
          if (ch) return avisarEphemeralAutoDelete(interaction, `⚠️ Você já tem um ticket: ${ch}`, 4500);
          ticketsAbertos.delete(userId);
        }

        const canal = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}-aberto`,
          type: ChannelType.GuildText,
          parent: CATEGORIA_TICKET_ID,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          ],
        });

        await canal.setTopic(`ticket-owner:${userId}`).catch(() => {});
        ticketsAbertos.set(userId, canal.id);

        await canal.send({ content: `🎫 Ticket de <@${userId}>`, components: [rowTicket()] });

        await avisarEphemeralAutoDelete(interaction, `✅ Ticket criado: ${canal}`, 4500);
      } catch (err) {
        console.error('❌ abrir_ticket:', err);
        await avisarEphemeralAutoDelete(interaction, '⚠️ Erro ao criar o ticket.', 4500);
      }
      return;
    }

    // FECHAR — dono ou staff: renomeia para -fechado e bloqueia dono
    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      await ackUpdate(interaction);

      try {
        const guild = interaction.guild;
        const ch = await fetchChannelSafe(guild, interaction.channel.id);
        if (!ch) return avisarEphemeralAutoDelete(interaction, '⚠️ Este ticket não existe mais (canal apagado).', 6000);

        const donoId = getTicketOwnerIdFromChannel(ch);
        if (!donoId) return avisarEphemeralAutoDelete(interaction, '⚠️ Não encontrei o dono do ticket.', 3500);

        const autorizado = (interaction.user.id === donoId) || isStaff(interaction.member);
        if (!autorizado) return avisarEphemeralAutoDelete(interaction, '🚫 Apenas o dono ou admin/staff pode FECHAR.', 4500);

        // Se o canal sumir durante a operação, cai em 10003 e a gente trata
        try {
          await ch.permissionOverwrites.edit(donoId, { SendMessages: false });
        } catch (e) {
          if (e?.code === 10003) return avisarEphemeralAutoDelete(interaction, '⚠️ O canal foi apagado durante a operação.', 6000);
          throw e;
        }

        const alvo = setTicketName(ch.name, 'fechado');
        const res = await renameWithVerify(guild, ch, alvo, '-fechado');
        if (!res.ok) {
          console.error('❌ Falha renomeando para fechado:', res.err?.message || res.err);
          return avisarEphemeralAutoDelete(interaction, '⚠️ Não consegui renomear para -fechado. Tente novamente.', 7000);
        }

        await avisarEphemeralAutoDelete(interaction, '🔒 Ticket fechado.', 3500);
      } catch (err) {
        console.error('❌ ticket_fechar:', err);
        await avisarEphemeralAutoDelete(interaction, '⚠️ Erro ao fechar o ticket.', 4500);
      }
      return;
    }

    // EDITAR — somente staff: fechado -> edicao (somente rename, sem perms)
    if (interaction.isButton() && interaction.customId === 'ticket_editar') {
      await ackUpdate(interaction);

      try {
        if (!isStaff(interaction.member)) {
          return avisarEphemeralAutoDelete(interaction, '🚫 Apenas admin/staff pode EDITAR.', 4500);
        }

        const guild = interaction.guild;
        const ch = await fetchChannelSafe(guild, interaction.channel.id);
        if (!ch) return avisarEphemeralAutoDelete(interaction, '⚠️ Este ticket não existe mais (canal apagado).', 6000);

        const status = getTicketStatusFromName(ch.name);
        if (status !== 'fechado') {
          return avisarEphemeralAutoDelete(interaction, 'ℹ️ Para editar, o ticket precisa estar FECHADO.', 4500);
        }

        const alvo = setTicketName(ch.name, 'edicao');
        const res = await renameWithVerify(guild, ch, alvo, '-edicao');
        if (!res.ok) {
          console.error('❌ Falha renomeando para edição:', res.err?.message || res.err);
          // dica importante: rate limit
          return avisarEphemeralAutoDelete(
            interaction,
            '⚠️ Não consegui mudar para -edicao (provável limite do Discord). Aguarde 30–60s e tente novamente.',
            9000
          );
        }

        logPainel(`Ticket em edição: ${alvo} (por ${interaction.user.tag})`);
        await avisarEphemeralAutoDelete(interaction, '✏️ Ticket em EDIÇÃO (nome -edicao aplicado).', 5000);
      } catch (err) {
        console.error('❌ ticket_editar:', err);
        await avisarEphemeralAutoDelete(interaction, '⚠️ Erro ao colocar ticket em edição.', 4500);
      }
      return;
    }

    // EXCLUIR — dono ou staff
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      await ackUpdate(interaction);

      try {
        const guild = interaction.guild;
        const ch = await fetchChannelSafe(guild, interaction.channel.id);
        if (!ch) return avisarEphemeralAutoDelete(interaction, '⚠️ Este ticket não existe mais (canal apagado).', 6000);

        const donoId = getTicketOwnerIdFromChannel(ch);
        if (!donoId) return avisarEphemeralAutoDelete(interaction, '⚠️ Não encontrei o dono do ticket.', 3500);

        const autorizado = (interaction.user.id === donoId) || isStaff(interaction.member);
        if (!autorizado) return avisarEphemeralAutoDelete(interaction, '🚫 Apenas o dono ou admin/staff pode EXCLUIR.', 4500);

        ticketsAbertos.delete(donoId);

        await avisarEphemeralAutoDelete(interaction, '🗑 Ticket será apagado em 2s...', 2500);
        setTimeout(() => ch.delete().catch(() => {}), 2000);
      } catch (err) {
        console.error('❌ ticket_excluir:', err);
        await avisarEphemeralAutoDelete(interaction, '⚠️ Erro ao excluir o ticket.', 4500);
      }
      return;
    }

    // SALVAR — somente staff e somente se FECHADO
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      await ackUpdate(interaction);

      try {
        if (!isStaff(interaction.member)) {
          return avisarEphemeralAutoDelete(interaction, '🚫 Apenas admin/staff pode SALVAR.', 4500);
        }

        const guild = interaction.guild;
        const ch = await fetchChannelSafe(guild, interaction.channel.id);
        if (!ch) return avisarEphemeralAutoDelete(interaction, '⚠️ Este ticket não existe mais (canal apagado).', 6000);

        const status = getTicketStatusFromName(ch.name);
        if (status !== 'fechado') {
          return avisarEphemeralAutoDelete(interaction, 'ℹ️ Para salvar, feche o ticket primeiro (status FECHADO).', 5000);
        }

        const ownerId = getTicketOwnerIdFromChannel(ch);
        if (!ownerId) return avisarEphemeralAutoDelete(interaction, '⚠️ Não encontrei o dono do ticket.', 3500);

        const data = await gerarTranscriptEResumo(ch);
        if (!data) return avisarEphemeralAutoDelete(interaction, '⚠️ Não consegui gerar o transcript.', 4500);

        const { transcript, resumo } = data;
        const safeResumo = resumo.length > 1900 ? (resumo.slice(0, 1900) + '\n...(resumo truncado)') : resumo;

        const canalRelatorio = await client.channels.fetch(CANAL_RELATORIO_ID).catch(() => null);
        if (canalRelatorio?.isTextBased()) await canalRelatorio.send({ content: safeResumo }).catch(() => {});

        const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
        if (canalTranscript?.isTextBased()) await canalTranscript.send({ content: safeResumo }).catch(() => {});

        const user = await client.users.fetch(ownerId).catch(() => null);
        if (user) {
          const buffer = Buffer.from(transcript || 'Sem mensagens', 'utf8');
          const fileName = `transcript-${ch.name}.txt`;
          await user.send({
            content: `📄 Seu ticket foi salvo.\n\n${safeResumo}`,
            files: [{ attachment: buffer, name: fileName }],
          }).catch(() => {});
        }

        ticketsAbertos.delete(ownerId);

        await avisarEphemeralAutoDelete(interaction, '💾 Ticket salvo. Canal será apagado.', 3500);
        setTimeout(() => ch.delete().catch(() => {}), 2500);

      } catch (err) {
        console.error('❌ ticket_salvar:', err);
        await avisarEphemeralAutoDelete(interaction, '⚠️ Erro ao salvar o ticket.', 4500);
      }
      return;
    }

  } catch (err) {
    console.error('❌ ERRO:', err);
  }
});

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log('✅ Bot online');
  await reconstruirTickets();
  await upsertPainelTicket();
  await upsertPainelPresenca();
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HARDEN PROCESS (não deixar Render reiniciar) ================= */
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
client.on('error', (err) => console.error('Discord Client error:', err));
client.on('shardError', (err) => console.error('Discord Shard error:', err));

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => console.log(`🌐 HTTP na porta ${PORT}`));
