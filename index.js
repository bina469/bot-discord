require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

/* ================= STATE ================= */
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
  for (let i = 0; i < 4; i++) {
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
function setTicketName(name, status /* aberto|fechado|edicao */) {
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

/* ================= PAINEL ABRIR TICKET (sem duplicar) ================= */
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
  const existente = msgs?.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes('🎫 **ATENDIMENTO — ABRIR TICKET**')
  );

  if (existente) await existente.edit(payload).catch(() => {});
  else await canal.send(payload).catch(() => {});
}

/* ================= READY ================= */
client.once('clientReady', async () => {
  log('✅ Bot online');
  await upsertPainelAbrirTicket();
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    log(`[CLICK] customId=${interaction.customId} channel=${interaction.channelId} user=${interaction.user?.id}`);

    /* ===== ABRIR TICKET (criar) ===== */
    if (interaction.customId === 'abrir_ticket') {
      await ackUpdate(interaction);

      try {
        const userId = interaction.user.id;

        const existenteId = ticketsAbertos.get(userId);
        if (existenteId) {
          const ch = interaction.guild.channels.cache.get(existenteId);
          if (ch) return toast(interaction, `⚠️ Você já tem um ticket: ${ch}`, 4500);
          ticketsAbertos.delete(userId);
        }

        // ✅ Overwrite explícito do BOT (à prova de 10003)
        const canal = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}-aberto`,
          type: ChannelType.GuildText,
          parent: CATEGORIA_TICKET_ID,
          permissionOverwrites: [
            {
              id: client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages,
              ],
            },
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            {
              id: userId,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },
            {
              id: CARGO_STAFF_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },
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

    /* ===== AÇÕES DENTRO DO TICKET ===== */
    if (!interaction.guild) return;
    await ackUpdate(interaction);

    const ch = await fetchChannelSafe(interaction.guild, interaction.channelId);
    if (!ch) {
      return toast(interaction, '⚠️ Este ticket não existe mais (ou o bot não tem acesso).', 8000);
    }

    const ownerId = getTicketOwnerIdFromChannel(ch);

    // FECHAR: dono OU staff (sempre fecha e bloqueia dono)
    if (interaction.customId === 'ticket_fechar') {
      if (!ownerId) return toast(interaction, '⚠️ Não encontrei o dono do ticket.', 5000);

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
        return toast(interaction, '⚠️ Erro ao fechar o ticket.', 7000);
      }
    }

    // EDITAR: somente staff, somente se fechado → edicao + libera dono escrever
    if (interaction.customId === 'ticket_editar') {
      if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode EDITAR.', 6000);
      if (!ownerId) return toast(interaction, '⚠️ Não encontrei o dono do ticket.', 5000);

      const status = getTicketStatusFromName(ch.name);
      if (status !== 'fechado') return toast(interaction, 'ℹ️ Para editar, o ticket precisa estar FECHADO.', 6000);

      try {
        await ch.permissionOverwrites.edit(ownerId, { SendMessages: true });

        const alvo = setTicketName(ch.name, 'edicao');
        const res = await renameWithVerify(interaction.guild, ch, alvo, '-edicao');
        if (!res.ok) {
          log(`❌ Falha renomeando para edição: ${res.err?.message || res.err}`);
          // reverte permissão, para não deixar solto
          await ch.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => {});
          return toast(interaction, '⚠️ Não consegui mudar para -edicao. Aguarde 30–60s e tente novamente.', 10000);
        }

        return toast(interaction, '✏️ Ticket em EDIÇÃO (dono liberado para enviar mensagens).', 7000);
      } catch (err) {
        log(`❌ ticket_editar error: ${err?.message || err}`);
        return toast(interaction, '⚠️ Erro ao colocar ticket em edição.', 7000);
      }
    }

    // EXCLUIR: dono OU staff
    if (interaction.customId === 'ticket_excluir') {
      if (!ownerId) return toast(interaction, '⚠️ Não encontrei o dono do ticket.', 5000);

      const autorizado = (interaction.user.id === ownerId) || isStaff(interaction.member);
      if (!autorizado) return toast(interaction, '🚫 Apenas o dono ou staff pode EXCLUIR.', 6000);

      try {
        ticketsAbertos.delete(ownerId);
        await toast(interaction, '🗑 Ticket será apagado em 2s...', 2500);
        setTimeout(() => ch.delete().catch(() => {}), 2000);
        return;
      } catch (err) {
        log(`❌ ticket_excluir error: ${err?.message || err}`);
        return toast(interaction, '⚠️ Erro ao excluir o ticket.', 7000);
      }
    }

    // SALVAR: somente staff, somente se fechado
    if (interaction.customId === 'ticket_salvar') {
      if (!isStaff(interaction.member)) return toast(interaction, '🚫 Apenas staff pode SALVAR.', 6000);
      if (!ownerId) return toast(interaction, '⚠️ Não encontrei o dono do ticket.', 5000);

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

  } catch (err) {
    console.error('❌ interactionCreate fatal:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HARDEN PROCESS ================= */
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
client.on('error', (err) => console.error('Discord Client error:', err));
client.on('shardError', (err) => console.error('Discord Shard error:', err));

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => console.log(`🌐 HTTP na porta ${PORT}`));
