require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const http = require('http');

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

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

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

const ticketsAbertos = new Map();

/* ================= HELPERS ================= */

async function responder(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp({ ...payload, flags: 64 });
    }
    return await interaction.reply({ ...payload, flags: 64 });
  } catch {}
}

/* ================= BOTÕES TICKET ================= */

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

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);

  await canalTicket.send({
    content: '🎫 **ATENDIMENTO — ABRIR TICKET**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('📂 Abrir Ticket')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ================= ABRIR ================= */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {

      if (ticketsAbertos.has(interaction.user.id))
        return responder(interaction, { content: '⚠️ Você já tem ticket aberto.' });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages
            ]
          },
          {
            id: CARGO_STAFF_ID,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages
            ]
          }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);

      await canal.send({
        content: `🎫 Ticket de <@${interaction.user.id}>`,
        components: [rowTicket()]
      });

      return responder(interaction, { content: `✅ Ticket criado: ${canal}` });
    }

    /* ================= FECHAR ================= */

    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {

      const donoId = [...ticketsAbertos.entries()]
        .find(([_, cid]) => cid === interaction.channel.id)?.[0];

      if (!donoId) return;

      await interaction.channel.permissionOverwrites.edit(donoId, {
        SendMessages: false
      });

      if (!interaction.channel.name.endsWith('-fechado')) {
        await interaction.channel.setName(
          interaction.channel.name.replace('-aberto', '') + '-fechado'
        );
      }

      return responder(interaction, { content: '🔒 Ticket fechado.' });
    }

    /* ================= ABRIR NOVAMENTE ================= */

    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {

      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return responder(interaction, { content: '🚫 Apenas administradores.' });

      const donoId = [...ticketsAbertos.entries()]
        .find(([_, cid]) => cid === interaction.channel.id)?.[0];

      if (donoId) {
        await interaction.channel.permissionOverwrites.edit(donoId, {
          SendMessages: true
        });
      }

      await interaction.channel.setName(
        interaction.channel.name.replace('-fechado', '') + '-aberto'
      );

      return responder(interaction, { content: '🔓 Ticket reaberto.' });
    }

    /* ================= TRANSCRIPT ================= */

    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {

      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      const msgs = await interaction.channel.messages.fetch({ limit: 100 });

      const transcript = msgs
        .reverse()
        .map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`)
        .join('\n');

      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);

      await canalTranscript.send({
        content: `📄 **Transcript — ${interaction.channel.name}**\n\n\`\`\`\n${transcript || 'Sem mensagens'}\n\`\`\``
      });

      return responder(interaction, { content: '💾 Transcript salvo.' });
    }

    /* ================= EXCLUIR ================= */

    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {

      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      await responder(interaction, { content: '🗑 Ticket será apagado...' });

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

/* ================= HTTP ================= */

http.createServer((_, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
