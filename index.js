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

const CARGO_STAFF_ID = '838753379332915280';
const CARGO_TELEFONISTA_ID = '1463421663101059154';

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_LOG_PRESENCA_ID = '1458342162981716039';

const CANAL_PAINEL_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_TICKET_ID = '1463408206129664128';

/* ================= TELEFONES ================= */
const TELEFONES = [
  'Pathy','Samantha','Rosalia','Rafaela',
  'Sophia','Ingrid','Valentina','Melissa'
];

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= ESTADO PRESENÇA ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let painelPresencaMsgId = null;

/* ================= ESTADO TICKETS ================= */
const tickets = new Map();

/* ================= UTIL ================= */
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = inicio => {
  const min = Math.floor((Date.now() - inicio) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

/* ================= RELATÓRIO PRESENÇA ================= */
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_LOG_PRESENCA_ID).catch(() => null);
  if (!canal) return;

  const data = hoje();
  if (!relatorioDiario[data]) return;

  let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;
  for (const tel in relatorioDiario[data]) {
    texto += `📞 **Telefone ${tel}**\n`;
    texto += relatorioDiario[data][tel].join('\n');
    texto += '\n──────────────\n';
  }

  await canal.send(texto);
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
}

/* ================= PAINEL PRESENÇA ================= */
async function atualizarPainelPresenca() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (!canal) return;

  const status = TELEFONES.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const botoes = TELEFONES.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoes.length; i += 5)
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Sair de todos').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Sair de um').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary)
    )
  );

  const conteudo = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (painelPresencaMsgId) {
    const msg = await canal.messages.fetch(painelPresencaMsgId).catch(() => null);
    if (msg) return msg.edit({ content: conteudo, components: rows });
  }

  const msg = await canal.send({ content: conteudo, components: rows });
  painelPresencaMsgId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  await atualizarPainelPresenca();

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
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ================= PRESENÇA ================= */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[telefone])
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[telefone] = {
        userId: interaction.user.id,
        nome: interaction.user.username,
        entrada: Date.now()
      };

      if (!atendimentosAtivos.has(interaction.user.id))
        atendimentosAtivos.set(interaction.user.id, []);
      atendimentosAtivos.get(interaction.user.id).push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${interaction.user.username} conectou`);
      await atualizarPainelPresenca();
      return interaction.reply({ content: `📞 Conectado em ${telefone}`, ephemeral: true });
    }

    /* ================= TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID))
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });

      tickets.set(canal.id, { donoId: interaction.user.id, donoNome: interaction.user.username });

      await canal.send({
        content: `🎫 Ticket de <@${interaction.user.id}>`,
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
