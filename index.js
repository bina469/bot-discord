const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

const CARGO_STAFF_ID = '838753379332915280';
const CARGO_TELEFONISTA_ID = '1463421663101059154';

const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= ESTADO ================= */
const tickets = new Map();

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const canalPainel = await client.channels.fetch(CANAL_ABRIR_TICKET_ID).catch(() => null);
  if (!canalPainel) return;

  const botao = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_ticket')
      .setLabel('🎫 Abrir Ticket')
      .setStyle(ButtonStyle.Primary)
  );

  await canalPainel.send({
    content: '📞 **Painel de Tickets — Telefonistas**',
    components: [botao]
  });
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    /* ================= ABRIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const member = interaction.member;

      if (!member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.reply({
          content: '❌ Você não tem permissão para abrir ticket.',
          ephemeral: true
        });
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
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
            allow: [PermissionsBitField.Flags.ViewChannel]
          }
        ]
      });

      tickets.set(canal.id, {
        donoId: interaction.user.id,
        donoNome: interaction.user.username
      });

      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('fechar_ticket')
          .setLabel('🔴 Fechar Ticket')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('salvar_ticket')
          .setLabel('💾 Salvar Ticket')
          .setStyle(ButtonStyle.Primary)
      );

      await canal.send({
        content: `🎫 Ticket aberto por <@${interaction.user.id}>`,
        components: [botoes]
      });

      return interaction.reply({
        content: `✅ Ticket criado: ${canal}`,
        ephemeral: true
      });
    }

    /* ================= AÇÕES DO TICKET ================= */
    if (!interaction.isButton()) return;
    if (!tickets.has(interaction.channel.id)) return;

    const ticket = tickets.get(interaction.channel.id);
    const member = interaction.member;
    const isStaff = member.roles.cache.has(CARGO_STAFF_ID);
    const isDono = interaction.user.id === ticket.donoId;

    /* ===== FECHAR ===== */
    if (interaction.customId === 'fechar_ticket') {
      if (!isStaff && !isDono) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
      }

      await interaction.channel.setName(`ticket-${ticket.donoNome}-fechado`);
      return interaction.reply({ content: '🔴 Ticket fechado.', ephemeral: true });
    }

    /* ===== SALVAR (STAFF) ===== */
    if (interaction.customId === 'salvar_ticket') {
      if (!isStaff) {
        return interaction.reply({ content: '❌ Apenas staff pode salvar.', ephemeral: true });
      }

      const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
      const texto = mensagens
        .reverse()
        .map(m => `[${m.author.tag}] ${m.content}`)
        .join('\n');

      const canalLog = await interaction.guild.channels.fetch(CANAL_TRANSCRIPT_ID);

      await canalLog.send({
        embeds: [
          {
            title: '📄 Transcript de Ticket',
            description: `**Ticket:** ${interaction.channel.name}\n\n\`\`\`\n${texto || 'Sem mensagens'}\n\`\`\``,
            color: 0x2ecc71
          }
        ]
      });

      tickets.delete(interaction.channel.id);
      await interaction.channel.delete();
    }

  } catch (err) {
    console.error('ERRO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= RENDER KEEP-ALIVE ================= */
const app = express();

app.get('/', (_, res) => {
  res.status(200).send('Bot online');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 HTTP ativo na porta ${PORT}`);
});
