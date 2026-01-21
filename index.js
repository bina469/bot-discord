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

const CANAL_PAINEL_ID = '1463407852583653479';
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
let painelMsgId = null;

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const canalPainel = await client.channels.fetch(CANAL_PAINEL_ID).catch(() => null);
  if (!canalPainel) return;

  const botao = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_ticket')
      .setLabel('🎫 Abrir Ticket')
      .setStyle(ButtonStyle.Primary)
  );

  if (painelMsgId) {
    const msg = await canalPainel.messages.fetch(painelMsgId).catch(() => null);
    if (msg) return msg.edit({ content: '📞 **Painel de Tickets**', components: [botao] });
  }

  const msg = await canalPainel.send({
    content: '📞 **Painel de Tickets**',
    components: [botao]
  });

  painelMsgId = msg.id;
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    /* ===== ABRIR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
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
          .setLabel('🔴 Fechar')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('salvar_ticket')
          .setLabel('💾 Salvar')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('excluir_ticket')
          .setLabel('🗑️ Excluir')
          .setStyle(ButtonStyle.Secondary)
      );

      await canal.send({
        content: `🎫 Ticket de <@${interaction.user.id}>`,
        components: [botoes]
      });

      const r = await interaction.reply({
        content: `✅ Ticket criado: ${canal}`,
        ephemeral: true
      });

      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    if (!interaction.isButton()) return;
    if (!tickets.has(interaction.channel.id)) return;

    const ticket = tickets.get(interaction.channel.id);
    const isStaff = interaction.member.roles.cache.has(CARGO_STAFF_ID);
    const isDono = interaction.user.id === ticket.donoId;

    /* ===== FECHAR ===== */
    if (interaction.customId === 'fechar_ticket') {
      if (!isStaff && !isDono)
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

      await interaction.channel.permissionOverwrites.edit(ticket.donoId, {
        SendMessages: false
      });

      await interaction.channel.setName(`ticket-${ticket.donoNome}-fechado`);

      const r = await interaction.reply({ content: '🔴 Ticket fechado.', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    }

    /* ===== EXCLUIR ===== */
    if (interaction.customId === 'excluir_ticket') {
      const msgs = await interaction.channel.messages.fetch({ limit: 10 });
      if (!isStaff && msgs.size > 1)
        return interaction.reply({ content: '⚠️ Ticket não está vazio.', ephemeral: true });

      tickets.delete(interaction.channel.id);
      await interaction.channel.delete();
    }

    /* ===== SALVAR ===== */
    if (interaction.customId === 'salvar_ticket') {
      if (!isStaff)
        return interaction.reply({ content: '❌ Apenas staff.', ephemeral: true });

      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const texto = msgs
        .reverse()
        .map(m => `[${m.author.tag}] ${m.content}`)
        .join('\n');

      const canalLog = await interaction.guild.channels.fetch(CANAL_TRANSCRIPT_ID);

      await canalLog.send({
        embeds: [{
          title: '📄 Transcript',
          description: `\`\`\`\n${texto || 'Sem mensagens'}\n\`\`\``,
          color: 0x2ecc71
        }]
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
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
