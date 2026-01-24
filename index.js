// === [ CORREÇÕES DE ESTABILIDADE — PAINEL + TICKET ] ===

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

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

/* ================= CONFIG ================= */

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_RELATORIO_ID = '1458342162981716039';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ================= ESTADO ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

let mensagemPainelId = null;
let mensagemRelatorioId = null;

const logsRelatorio = [];
const ticketsAbertos = new Map();

/* ================= HELPERS ================= */

async function responderTemp(interaction, texto, tempo = 5000) {
  if (interaction.replied || interaction.deferred) return;

  const msg = await interaction.reply({ content: texto, ephemeral: true });

  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, tempo);
}

/* ================= RELATÓRIO ================= */

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

async function enviarRelatorio(acao, detalhes) {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);

  logsRelatorio.push(`[${horarioBrasilia()}] ${acao} — ${detalhes}`);

  const texto = `📋 **RELATÓRIO DO PAINEL**\n\n${logsRelatorio.join('\n')}`;

  if (mensagemRelatorioId) {
    try {
      const msg = await canal.messages.fetch(mensagemRelatorioId);
      return msg.edit(texto);
    } catch {
      mensagemRelatorioId = null;
    }
  }

  const msg = await canal.send(texto);
  mensagemRelatorioId = msg.id;
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

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      telefones.map(t =>
        new ButtonBuilder()
          .setCustomId(`entrar_${t}`)
          .setLabel(`📞 ${t}`)
          .setStyle(ButtonStyle.Success)
      )
    ),
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
        .setCustomId('menu_forcar')
        .setLabel('⚠️ Forçar')
        .setStyle(ButtonStyle.Danger)
    )
  ];

  if (mensagemPainelId) {
    try {
      const msg = await canal.messages.fetch(mensagemPainelId);
      return msg.edit({ content: texto, components: rows });
    } catch {
      mensagemPainelId = null;
    }
  }

  const msgs = await canal.messages.fetch({ limit: 10 });
  const antiga = msgs.find(m => m.author.id === client.user.id);

  if (antiga) {
    mensagemPainelId = antiga.id;
    return antiga.edit({ content: texto, components: rows });
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
          .setLabel('📂 Abrir Ticket')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  try {

    // ===== PAINEL ENTRAR =====
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel])
        return responderTemp(interaction, '⚠️ Telefone ocupado.');

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      atendimentosAtivos.set(interaction.user.id, [
        ...(atendimentosAtivos.get(interaction.user.id) || []),
        tel
      ]);

      await atualizarPainel();
      await enviarRelatorio('📞 Conectou', `${interaction.user.username} → ${tel}`);

      return responderTemp(interaction, `📞 Conectado ao ${tel}`);
    }

    // ===== TICKET =====
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (ticketsAbertos.has(interaction.user.id))
        return responderTemp(interaction, '⚠️ Você já tem ticket.');

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
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
        content: '🎫 Ticket iniciado.',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('ticket_fechar')
              .setLabel('🔒 Fechar')
              .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
              .setCustomId('ticket_transcript')
              .setLabel('📄 Transcript')
              .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
              .setCustomId('ticket_excluir')
              .setLabel('🗑 Excluir')
              .setStyle(ButtonStyle.Danger)
          )
        ]
      });

      return responderTemp(interaction, `✅ Ticket criado: ${canal}`);
    }

    // ===== FECHAR TICKET =====
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      const canal = interaction.channel;

      const dono = [...ticketsAbertos.entries()].find(
        ([, id]) => id === canal.id
      );

      if (dono) ticketsAbertos.delete(dono[0]);

      await canal.delete();
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
