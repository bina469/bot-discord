const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

const CANAL_PAINEL_ID = '1458337803715739699';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha','Rosalia','Ingrid','Melissa','Cloe'];
const estadoTelefones = {};
let painelMsgId = null;

/* ================= TICKET ================= */
const tickets = new Map();

/* ================= UTIL ================= */
const hora = () => new Date().toLocaleTimeString('pt-BR');

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_ID).catch(() => null);
  if (!canal) return;

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const botoesTel = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTel.length; i += 5)
    rows.push(new ActionRowBuilder().addComponents(botoesTel.slice(i, i + 5)));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('abrir_ticket').setLabel('🎫 Abrir Ticket').setStyle(ButtonStyle.Primary)
  ));

  if (painelMsgId) {
    const msg = await canal.messages.fetch(painelMsgId).catch(() => null);
    if (msg) return msg.edit({ content: status, components: rows });
  }

  const msg = await canal.send({ content: status, components: rows });
  painelMsgId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== ABRIR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      tickets.set(canal.id, {
        userId: interaction.user.id,
        aberto: Date.now()
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔒 Fechar Ticket').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑 Excluir Ticket').setStyle(ButtonStyle.Danger)
      );

      await canal.send({ content: `🎫 Ticket aberto por ${interaction.user}`, components: [row] });
      return interaction.reply({ content: `Ticket criado: ${canal}`, ephemeral: true });
    }

    /* ===== FECHAR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      const info = tickets.get(interaction.channel.id);
      if (!info) return;

      await interaction.channel.permissionOverwrites.edit(info.userId, {
        SendMessages: false
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reabrir_ticket').setLabel('🔓 Reabrir').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ content: '🔒 Ticket fechado.', components: [row] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

      const user = await client.users.fetch(info.userId).catch(() => null);
      if (user) {
        user.send(
          `📄 **Resumo do Ticket**\nCanal: ${interaction.channel.name}\nFechado às: ${hora()}`
        ).catch(() => {});
      }
    }

    /* ===== REABRIR ===== */
    if (interaction.isButton() && interaction.customId === 'reabrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return interaction.reply({ content: 'Apenas staff.', ephemeral: true });

      const info = tickets.get(interaction.channel.id);
      if (!info) return;

      await interaction.channel.permissionOverwrites.edit(info.userId, {
        SendMessages: true
      });

      await interaction.reply({ content: '🔓 Ticket reaberto.' });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    }

    /* ===== EXCLUIR ===== */
    if (interaction.isButton() && interaction.customId === 'excluir_ticket') {
      await interaction.reply({ content: '🗑 Ticket será excluído.' });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    }

  } catch (e) {
    console.error(e);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Online'));
app.listen(process.env.PORT || 3000);
