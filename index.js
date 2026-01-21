const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ChannelType,
  InteractionResponseFlags
} = require('discord.js');

const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

// PRESENÇA
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// TICKET
const CANAL_PAINEL_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_TICKET_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
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

/* ================= ESTADO ================= */
const presenca = new Map(); // telefoneId -> userId
const tickets = new Map();

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  /* ===== PAINEL PRESENÇA ===== */
  const canalPresenca = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (canalPresenca) {
    await canalPresenca.bulkDelete(5).catch(() => {});
    await canalPresenca.send({
      content: '📞 **Painel de Presença**',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('conectar').setLabel('🟢 Conectar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('desconectar').setLabel('🔴 Desconectar').setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('desconectar_um').setLabel('➖ Desconectar um').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('transferir').setLabel('🔁 Transferir').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('forcar_desconexao').setLabel('⚠️ Forçar').setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  /* ===== PAINEL TICKET ===== */
  const canalTicket = await client.channels.fetch(CANAL_PAINEL_TICKET_ID).catch(() => null);
  if (canalTicket) {
    await canalTicket.bulkDelete(5).catch(() => {});
    await canalTicket.send({
      content: '🎫 **Painel de Tickets**',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('abrir_ticket')
            .setLabel('🎫 Abrir Ticket')
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });
  }
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    /* ===== BOTÕES ===== */
    if (interaction.isButton()) {
      await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });

      /* ===== ABRIR TICKET ===== */
      if (interaction.customId === 'abrir_ticket') {
        if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
          return interaction.editReply('❌ Sem permissão.');
        }

        const canal = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
          ]
        });

        tickets.set(canal.id, interaction.user.id);

        await canal.send({
          content: `🎫 Ticket de <@${interaction.user.id}>`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔴 Fechar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('reabrir_ticket').setLabel('🟢 Reabrir').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑️ Excluir').setStyle(ButtonStyle.Secondary)
            )
          ]
        });

        return interaction.editReply(`✅ Ticket criado: ${canal}`);
      }

      return interaction.editReply('✅ Ação processada.');
    }
  } catch (err) {
    console.error('ERRO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
