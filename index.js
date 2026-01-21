const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

const CARGO_STAFF_ID = '838753379332915280';
const CARGO_TELEFONISTA_ID = '1463421663101059154';

const CANAL_ABRIR_TICKET_ID = 'COLOQUE_AQUI';
const CANAL_TRANSCRIPT_ID = 'COLOQUE_AQUI';

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
client.once('ready', () => {
  console.log(`✅ Logado como ${client.user.tag}`);
});

/* ================= ABRIR TICKET ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const member = interaction.member;

  if (interaction.customId === 'abrir_ticket') {
    if (!member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
      return interaction.reply({ content: '❌ Você não pode abrir ticket.', ephemeral: true });
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
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        },
        {
          id: CARGO_TELEFONISTA_ID,
          allow: [PermissionsBitField.Flags.ViewChannel]
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
      new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔴 Fechar Ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('apagar_ticket').setLabel('🗑️ Apagar Ticket').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('salvar_ticket').setLabel('💾 Salvar Ticket').setStyle(ButtonStyle.Primary)
    );

    await canal.send({
      content: `🎫 Ticket aberto por <@${interaction.user.id}>\nStatus: 🟢 Online`,
      components: [botoes]
    });

    await interaction.reply({ content: `✅ Ticket criado: ${canal}`, ephemeral: true });
  }
});

/* ================= AÇÕES DO TICKET ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.channel || !tickets.has(interaction.channel.id)) return;

  const ticket = tickets.get(interaction.channel.id);
  const member = interaction.member;
  const isStaff = member.roles.cache.has(CARGO_STAFF_ID);
  const isDono = interaction.user.id === ticket.donoId;

  /* ===== FECHAR ===== */
  if (interaction.customId === 'fechar_ticket') {
    if (!isStaff && !isDono)
      return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

    await interaction.channel.setName(`ticket-${ticket.donoNome}-offline`);
    await interaction.reply({ content: '🔴 Ticket fechado.', ephemeral: true });
  }

  /* ===== APAGAR ===== */
  if (interaction.customId === 'apagar_ticket') {
    const mensagens = await interaction.channel.messages.fetch();
    if (!isStaff && mensagens.size > 1)
      return interaction.reply({ content: '⚠️ Ticket possui atendimento.', ephemeral: true });

    await interaction.channel.delete();
    tickets.delete(interaction.channel.id);
  }

  /* ===== SALVAR (STAFF) ===== */
  if (interaction.customId === 'salvar_ticket') {
    if (!isStaff)
      return interaction.reply({ content: '❌ Apenas staff.', ephemeral: true });

    const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
    const texto = mensagens
      .reverse()
      .map(m => `[${m.author.tag}] ${m.content}`)
      .join('\n');

    const canalLog = await interaction.guild.channels.fetch(CANAL_TRANSCRIPT_ID);
    await canalLog.send(`📄 **Transcript — ${interaction.channel.name}**\n\`\`\`\n${texto}\n\`\`\``);

    await interaction.channel.permissionOverwrites.edit(ticket.donoId, {
      ViewChannel: false
    });

    await interaction.reply({ content: '💾 Ticket salvo e arquivado.', ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
