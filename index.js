const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');

const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const CANAL_PAINEL_ID = '1458337803715739699';
const CANAL_RELATORIO_ID = '1458342162981716039';

const CANAL_PAINEL_TICKET_ID = '1463407852583653479';
const CANAL_TICKET_SALVO_ID = '1463408206129664128';
const CARGO_ADMIN_ID = '838753379332915280';

const TOKEN = process.env.TOKEN;

/* ================= BOT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= TELEFONES ================= */
const telefones = ['Samantha', 'Rosalia', 'Ingrid', 'Melissa', 'Cloe'];

/* ================= ESTADO ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};

const ticketsAbertos = new Map(); // userId -> channelId

let mensagemPainelId = null;
let mensagemRelatorioId = null;
let mensagemPainelTicketId = null;

/* ================= UTIL ================= */
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

const isAdmin = member =>
  member.roles.cache.has(CARGO_ADMIN_ID);

/* ================= RELATÓRIO ================= */
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);
  const data = hoje();
  if (!relatorioDiario[data]) return;

  let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;

  for (const tel of Object.keys(relatorioDiario[data])) {
    texto += `📞 **Telefone ${tel}**\n`;
    texto += relatorioDiario[data][tel].join('\n');
    texto += `\n────────────────────\n`;
  }

  if (mensagemRelatorioId) {
    const msg = await canal.messages.fetch(mensagemRelatorioId).catch(() => null);
    if (msg) return msg.edit(texto);
  }

  const msg = await canal.send(texto);
  mensagemRelatorioId = msg.id;
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
}

/* ================= PAINEL TELEFONES ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_ID);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
      : `🟢 Telefone ${t} — Livre`
  ).join('\n');

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
      new ButtonBuilder().setCustomId('forcar_desconectar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Danger)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) return msg.edit({ content: texto, components: rows });
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= PAINEL TICKET ================= */
async function painelTicket() {
  const canal = await client.channels.fetch(CANAL_PAINEL_TICKET_ID);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_ticket')
      .setLabel('🟢 Abrir Ticket')
      .setStyle(ButtonStyle.Success)
  );

  if (mensagemPainelTicketId) {
    const msg = await canal.messages.fetch(mensagemPainelTicketId).catch(() => null);
    if (msg) return msg.edit({ content: '🎫 **PAINEL DE TICKET**', components: [row] });
  }

  const msg = await canal.send({ content: '🎫 **PAINEL DE TICKET**', components: [row] });
  mensagemPainelTicketId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
  await painelTicket();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== ABRIR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (ticketsAbertos.has(interaction.user.id))
        return interaction.reply({ content: '⚠️ Você já tem um ticket aberto.', ephemeral: true });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_ADMIN_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔴 Fechar Ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('salvar_ticket').setLabel('💾 Salvar Ticket').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('reabrir_ticket').setLabel('🔄 Reabrir Ticket').setStyle(ButtonStyle.Secondary)
      );

      await canal.send({ content: `🎫 Ticket de ${interaction.user}`, components: [row] });
      return interaction.reply({ content: '✅ Ticket aberto!', ephemeral: true });
    }

    /* ===== FECHAR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      if (!isAdmin(interaction.member) && interaction.channel.permissionOverwrites.cache.get(interaction.user.id))
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false });

      return interaction.reply({ content: '🔒 Ticket fechado.', ephemeral: true });
    }

    /* ===== REABRIR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'reabrir_ticket') {
      if (!isAdmin(interaction.member))
        return interaction.reply({ content: '❌ Apenas admin.', ephemeral: true });

      const openerId = [...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id)?.[0];
      if (openerId)
        await interaction.channel.permissionOverwrites.edit(openerId, { SendMessages: true });

      return interaction.reply({ content: '🔓 Ticket reaberto.', ephemeral: true });
    }

    /* ===== SALVAR TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'salvar_ticket') {
      if (!isAdmin(interaction.member))
        return interaction.reply({ content: '❌ Apenas admin.', ephemeral: true });

      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const embed = new EmbedBuilder()
        .setTitle('📄 Transcript de Ticket')
        .setColor(0x2ecc71)
        .setTimestamp();

      let texto = '';
      msgs.reverse().forEach(m => {
        texto += `**${m.author.username}**: ${m.content}\n`;
      });

      embed.setDescription(texto || 'Sem mensagens');

      const canalSalvo = await client.channels.fetch(CANAL_TICKET_SALVO_ID);
      await canalSalvo.send({ embeds: [embed] });

      const opener = [...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id);
      if (opener) ticketsAbertos.delete(opener[0]);

      await interaction.channel.delete();
    }

  } catch (err) {
    console.error(err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Online'));
app.listen(process.env.PORT || 3000);
