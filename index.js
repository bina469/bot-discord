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

/* ================= PAINEL ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

let mensagemPainelId = null;

/* ================= RELATÓRIO ================= */

let mensagemRelatorioId = null;
const logsRelatorio = [];

/* ================= TICKETS ================= */

const ticketsAbertos = new Map();

/* ================= HELPERS ================= */

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

async function responderTemp(interaction, texto, tempo = 5000) {
  const msg = await interaction.reply({
    content: texto,
    fetchReply: true
  });

  setTimeout(() => msg.delete().catch(() => {}), tempo);
}

/* ================= PAINEL ================= */

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones
    .map(t =>
      estadoTelefones[t]
        ? `🔴 ${t} — ${estadoTelefones[t].nome}`
        : `🟢 ${t} — Livre`
    )
    .join('\n');

  const botoes = telefones.map(t =>
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
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Secondary)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    try {
      const msg = await canal.messages.fetch(mensagemPainelId);
      return msg.edit({ content: texto, components: rows });
    } catch {
      mensagemPainelId = null;
    }
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');

  await atualizarPainel();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);

  await canalTicket.send({
    content: '🎫 **ATENDIMENTO**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('📂 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ================= CRIAR TICKET ================= */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (ticketsAbertos.has(interaction.user.id))
        return responderTemp(interaction, '⚠️ Você já possui ticket.');

      await interaction.deferReply({ ephemeral: true });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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

      const botoesTicket = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_abrir').setLabel('🟢 Abrir').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔴 Fechar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar (ADM)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑️ Excluir').setStyle(ButtonStyle.Danger)
      );

      await canal.send({
        content: '🎫 **Controle do Ticket**',
        components: [botoesTicket]
      });

      await interaction.editReply({
        content: `✅ Ticket criado: ${canal}`
      });
    }

    /* ================= CONTROLE TICKET ================= */

    if (!interaction.channel?.name?.startsWith('ticket-')) return;

    const donoId = [...ticketsAbertos.entries()].find(
      ([, c]) => c === interaction.channel.id
    )?.[0];

    const isAdmin = interaction.member.roles.cache.has(CARGO_STAFF_ID);

    /* ===== FECHAR ===== */

    if (interaction.customId === 'ticket_fechar') {
      await interaction.channel.permissionOverwrites.edit(donoId, {
        SendMessages: false
      });

      return responderTemp(interaction, '🔒 Ticket fechado.');
    }

    /* ===== ABRIR ===== */

    if (interaction.customId === 'ticket_abrir') {
      if (!isAdmin) return responderTemp(interaction, '❌ Apenas ADM.');

      await interaction.channel.permissionOverwrites.edit(donoId, {
        SendMessages: true
      });

      return responderTemp(interaction, '🟢 Ticket reaberto.');
    }

    /* ===== SALVAR ===== */

    if (interaction.customId === 'ticket_salvar') {
      if (!isAdmin) return responderTemp(interaction, '❌ Apenas ADM.');

      const mensagens = await interaction.channel.messages.fetch({ limit: 100 });

      const resumo = mensagens
        .reverse()
        .map(m => `[${m.author.username}] ${m.content}`)
        .join('\n');

      const dono = await interaction.guild.members.fetch(donoId);

      await dono.send({
        content: `📋 **Resumo do Ticket**\n\n${resumo || 'Sem mensagens.'}`
      });

      return responderTemp(interaction, '💾 Ticket salvo e enviado ao usuário.');
    }

    /* ===== EXCLUIR ===== */

    if (interaction.customId === 'ticket_excluir') {
      if (!isAdmin) return responderTemp(interaction, '❌ Apenas ADM.');

      await responderTemp(interaction, '🗑️ Ticket será apagado...');

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 5000);
    }

  } catch (err) {
    console.error('❌ ERRO INTERAÇÃO:', err);
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);

/* ================= HTTP ================= */

http.createServer((_, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
