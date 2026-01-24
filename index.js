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
  PermissionsBitField
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

// IDs (mantenha os seus)
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699'; // se você tiver painel de presença, vamos tratar abaixo
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS (Render-safe) ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {
  console.error('❌ Não foi possível criar pasta logs:', e);
}

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
    GatewayIntentBits.MessageContent
  ]
});

/* ================= ESTADO ================= */
const ticketsAbertos = new Map(); // userId -> channelId

/* ================= HELPERS ================= */
async function responder(interaction, payload) {
  try {
    const data = { ...payload, ephemeral: true };
    if (interaction.replied || interaction.deferred) return await interaction.followUp(data);
    return await interaction.reply(data);
  } catch {}
}

function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_salvar')
      .setLabel('💾 Salvar')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('ticket_fechar')
      .setLabel('🔒 Fechar')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('ticket_abrir')
      .setLabel('🔓 Abrir')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('ticket_excluir')
      .setLabel('🗑 Excluir')
      .setStyle(ButtonStyle.Danger)
  );
}

// Procura painel existente (mensagem do bot) e edita; se não existir, envia
async function upsertPainel(channelId, uniqueMarkerText, payload) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const msgs = await ch.messages.fetch({ limit: 25 }).catch(() => null);
  if (!msgs) return;

  const existente = msgs.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes(uniqueMarkerText)
  );

  if (existente) {
    await existente.edit(payload).catch(() => {});
  } else {
    await ch.send(payload).catch(() => {});
  }
}

/* ================= BOOT: reconstruir tickets existentes ================= */
async function reconstruirTickets() {
  ticketsAbertos.clear();

  const categoria = await client.channels.fetch(CATEGORIA_TICKET_ID).catch(() => null);
  if (!categoria || !categoria.children) return;

  for (const [, ch] of categoria.children.cache) {
    if (ch.type !== ChannelType.GuildText) continue;

    const topic = ch.topic || '';
    const match = topic.match(/ticket-owner:(\d+)/);
    if (match) {
      const userId = match[1];
      ticketsAbertos.set(userId, ch.id);
    }
  }

  logPainel(`Reconstrução de tickets: ${ticketsAbertos.size} encontrados.`);
}

/* ================= READY ================= */
// discord.js v15: use clientReady
client.once('clientReady', async () => {
  console.log('✅ Bot online');

  await reconstruirTickets();

  // Painel de ticket (não duplica)
  await upsertPainel(
    CANAL_ABRIR_TICKET_ID,
    '🎫 **ATENDIMENTO — ABRIR TICKET**',
    {
      content: '🎫 **ATENDIMENTO — ABRIR TICKET**',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('abrir_ticket')
            .setLabel('📂 Abrir Ticket')
            .setStyle(ButtonStyle.Primary)
        )
      ]
    }
  );

  // Se você tem painel de presença e ele estava duplicando,
  // faça o mesmo "upsertPainel" com um texto marcador único:
  // (ajuste o conteúdo/componentes conforme o seu painel real)
  // await upsertPainel(
  //   CANAL_PAINEL_PRESENCA_ID,
  //   '📞 **PAINEL DE PRESENÇA**',
  //   { content: '📞 **PAINEL DE PRESENÇA**', components: [] }
  // );
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    /* ================= ABRIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const userId = interaction.user.id;

      // Se tem no Map, valida se o canal ainda existe. Se não existir, limpa.
      const canalIdExistente = ticketsAbertos.get(userId);
      if (canalIdExistente) {
        const ch = interaction.guild.channels.cache.get(canalIdExistente);
        if (ch) return responder(interaction, { content: `⚠️ Você já tem um ticket aberto: ${ch}` });
        ticketsAbertos.delete(userId);
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      // Persistência do dono no topic (sobrevive a restart)
      await canal.setTopic(`ticket-owner:${userId}`).catch(() => {});

      ticketsAbertos.set(userId, canal.id);

      await canal.send({
        content: `🎫 Ticket de <@${userId}>`,
        components: [rowTicket()]
      });

      logPainel(`Ticket aberto por ${interaction.user.tag} (${userId})`);

      return responder(interaction, { content: `✅ Ticket criado: ${canal}` });
    }

    /* ================= FECHAR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;
      if (!donoId) return;

      await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false }).catch(() => {});
      if (!interaction.channel.name.endsWith('-fechado')) {
        const novoNome = interaction.channel.name.replace('-aberto', '').replace(/-fechado$/, '') + '-fechado';
        await interaction.channel.setName(novoNome).catch(() => {});
      }

      logPainel(`Ticket fechado: ${interaction.channel.name}`);
      return responder(interaction, { content: '🔒 Ticket fechado.' });
    }

    /* ================= REABRIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
        return responder(interaction, { content: '🚫 Apenas administradores/staff.' });
      }

      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;

      if (donoId) {
        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true }).catch(() => {});
        ticketsAbertos.set(donoId, interaction.channel.id);
      }

      const novoNome = interaction.channel.name.replace('-fechado', '').replace(/-aberto$/, '') + '-aberto';
      await interaction.channel.setName(novoNome).catch(() => {});

      logPainel(`Ticket reaberto: ${interaction.channel.name}`);
      return responder(interaction, { content: '🔓 Ticket reaberto.' });
    }

    /* ================= SALVAR TRANSCRIPT ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
        return responder(interaction, { content: '🚫 Apenas staff.' });
      }

      const msgs = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!msgs) return responder(interaction, { content: '⚠️ Não consegui buscar mensagens para salvar.' });

      const transcript = msgs
        .reverse()
        .map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || ''}`)
        .join('\n');

      // Envia para canal de transcript
      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
      if (canalTranscript?.isTextBased()) {
        // Evita estourar limite de 2000 chars: manda como bloco truncado se necessário
        const max = 1800;
        const body = (transcript || 'Sem mensagens');
        const safe = body.length > max ? body.slice(0, max) + '\n...(truncado)' : body;

        await canalTranscript.send({
          content: `📄 **Transcript — ${interaction.channel.name}**\n\`\`\`\n${safe}\n\`\`\``
        }).catch(() => {});
      }

      // Envia para DM do dono
      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;

      if (donoId) {
        const user = await client.users.fetch(donoId).catch(() => null);
        if (user) {
          const max = 1800;
          const body = (transcript || 'Sem mensagens');
          const safe = body.length > max ? body.slice(0, max) + '\n...(truncado)' : body;

          await user.send({
            content: `📄 Seu ticket "${interaction.channel.name}" foi salvo.\n\`\`\`\n${safe}\n\`\`\``
          }).catch(() => {});
        }
      }

      logPainel(`Transcript salvo: ${interaction.channel.name}`);
      return responder(interaction, { content: '💾 Transcript salvo.' });
    }

    /* ================= EXCLUIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
        return responder(interaction, { content: '🚫 Apenas staff.' });
      }

      // Remove do Map antes de apagar
      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;
      if (donoId) ticketsAbertos.delete(donoId);

      await responder(interaction, { content: '🗑 Ticket será apagado em 3s...' });

      logPainel(`Ticket excluído: ${interaction.channel.name}`);

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 3000);
    }

  } catch (err) {
    console.error('❌ ERRO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HARDEN PROCESS (evita restart em loop) ================= */
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
client.on('error', (err) => console.error('Discord Client error:', err));
client.on('shardError', (err) => console.error('Discord Shard error:', err));

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => {
  console.log(`🌐 HTTP na porta ${PORT}`);
});
