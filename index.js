const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');
const express = require('express');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ================= CONFIG ================= */
const canalPainelId = '1414723351125033190';
const canalRelatorioId = '1458539184452276336';
const TOKEN = process.env.TOKEN;

/* ================= TELEFONES ================= */
const telefones = [
  'Pathy','Samantha','Rosalia','Rafaela',
  'Sophia','Ingrid','Valentina','Melissa',
  'Alina'
];

/* ================= ESTADO ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
let mensagemPainelId = null;

/* ================= UTIL ================= */
function hora() { return new Date().toLocaleTimeString('pt-BR'); }
function tempo(entrada) {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(canalPainelId);

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
  for (let i = 0; i < botoes.length; i += 5)
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('sair_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('forcar').setLabel('🛑 Forçar Desconexão').setStyle(ButtonStyle.Danger)
  ));

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId);
    await msg.edit({ content: texto, components: rows });
  } else {
    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;
  }
}

/* ================= BOT ================= */
client.once('ready', async () => {
  console.log('🚀 Bot online');
  await atualizarPainel();
});

client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  /* ===== CONECTAR ===== */
  if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
    const tel = interaction.customId.replace('entrar_', '');
    if (estadoTelefones[tel]) {
      await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    estadoTelefones[tel] = { userId: user.id, nome: user.username, entrada: Date.now() };
    if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
    atendimentosAtivos.get(user.id).push(tel);

    await atualizarPainel();
    await interaction.reply({ content: `📞 Conectado ao telefone ${tel}`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== DESCONECTAR TODOS ===== */
  if (interaction.isButton() && interaction.customId === 'sair_todos') {
    await interaction.reply({ content: '📴 Desconectando...', ephemeral: true });

    const lista = atendimentosAtivos.get(user.id) || [];
    for (const tel of lista) delete estadoTelefones[tel];
    atendimentosAtivos.delete(user.id);

    await atualizarPainel();
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== DESCONECTAR UM ===== */
  if (interaction.isButton() && interaction.customId === 'sair_um') {
    const lista = atendimentosAtivos.get(user.id) || [];
    if (!lista.length) {
      await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_sair')
      .addOptions(lista.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '🟠 Escolha o telefone',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_sair') {
    const tel = interaction.values[0];
    delete estadoTelefones[tel];
    atendimentosAtivos.get(user.id).splice(
      atendimentosAtivos.get(user.id).indexOf(tel), 1
    );

    await atualizarPainel();
    await interaction.reply({ content: `📴 ${tel} desconectado`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== FORÇAR ===== */
  if (interaction.isButton() && interaction.customId === 'forcar') {
    const ocupados = Object.keys(estadoTelefones);
    if (!ocupados.length) {
      await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_forcar')
      .addOptions(ocupados.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '🛑 Selecione o telefone',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_forcar') {
    const tel = interaction.values[0];
    delete estadoTelefones[tel];

    await atualizarPainel();
    await interaction.reply({ content: `🛑 ${tel} desconectado à força`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
