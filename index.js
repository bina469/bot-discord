const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

/* ===== TICKET ===== */
const CARGO_TICKET_STAFF_ID = '838753379332915280';
const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CANAL_PAINEL_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_TICKET_ID = '1463408206129664128';

/* ===== PAINEL PRESENÇA ===== */
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_LOG_PRESENCA_ID = '1458342162981716039';

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= ESTADOS ================= */
const tickets = new Map();
const estadoTelefones = {};
const atendimentosAtivos = new Map();

/* ================= UTIL ================= */
const hora = () => new Date().toLocaleTimeString('pt-BR');

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  /* ===== PAINEL TICKET ===== */
  const canalTicket = await client.channels.fetch(CANAL_PAINEL_TICKET_ID);
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

  /* ===== PAINEL PRESENÇA ===== */
  const canalPresenca = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const botoes = TELEFONES.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoes.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('menu_sair')
        .setLabel('🟠 Desconectar UM')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('menu_transferir')
        .setLabel('🔵 Transferir')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('forcar_desconexao')
        .setLabel('⛔ Forçar')
        .setStyle(ButtonStyle.Danger)
    )
  );

  await canalPresenca.send({
    content: '📞 **Painel de Presença**',
    components: rows
  });
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    /* ================= PAINEL PRESENÇA ================= */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel])
        return interaction.reply({ content: '📵 Ocupado.', ephemeral: true });

      estadoTelefones[tel] = { userId: user.id, nome: user.username };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(tel);

      const log = await client.channels.fetch(CANAL_LOG_PRESENCA_ID);
      await log.send(`🟢 ${hora()} — ${user.username} entrou no ${tel}`);

      return interaction.reply({ content: `📞 Conectado em ${tel}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length)
        return interaction.reply({ content: '⚠️ Nenhum telefone.', ephemeral: true });

      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('sair_um')
              .setPlaceholder('Escolha')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const tel = interaction.values[0];
      delete estadoTelefones[tel];
      atendimentosAtivos.set(user.id, atendimentosAtivos.get(user.id).filter(t => t !== tel));

      const log = await client.channels.fetch(CANAL_LOG_PRESENCA_ID);
      await log.send(`🔴 ${hora()} — ${user.username} saiu do ${tel}`);

      return interaction.update({ content: `📴 Saiu do ${tel}`, components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length)
        return interaction.reply({ content: '⚠️ Nenhum telefone.', ephemeral: true });

      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('transferir_tel')
              .setPlaceholder('Telefone')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      return interaction.update({
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`transferir_user_${interaction.values[0]}`)
              .setPlaceholder('Telefonista')
          )
        ]
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
      const tel = interaction.customId.replace('transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = estadoTelefones[tel];

      estadoTelefones[tel] = { userId: novoId, nome: novoUser.username };
      atendimentosAtivos.set(antigo.userId, atendimentosAtivos.get(antigo.userId).filter(t => t !== tel));
      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(tel);

      const log = await client.channels.fetch(CANAL_LOG_PRESENCA_ID);
      await log.send(`🔁 ${hora()} — ${antigo.nome} → ${novoUser.username} (${tel})`);

      return interaction.update({ content: '✅ Transferido.', components: [] });
    }

    /* ================= TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID))
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_TICKET_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });

      tickets.set(canal.id, { donoId: user.id, donoNome: user.username });

      await canal.send({
        content: `🎫 Ticket de <@${user.id}>`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔴 Fechar').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('salvar_ticket').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑️ Excluir').setStyle(ButtonStyle.Secondary)
          )
        ]
      });

      return interaction.reply({ content: `✅ Ticket criado: ${canal}`, ephemeral: true });
    }

  } catch (e) {
    console.error('ERRO:', e);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= RENDER ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
