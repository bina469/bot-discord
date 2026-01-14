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
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

/* ================= UTIL ================= */
function hoje() { return new Date().toLocaleDateString('pt-BR'); }
function hora() { return new Date().toLocaleTimeString('pt-BR'); }
function tempo(entrada) {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

/* ================= RELATÓRIO ================= */
async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(canalPainelId);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
      : `🟢 Telefone ${t} — Livre`
  ).join('\n');

  const botoesTelefone = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTelefone.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sair_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('forcar').setLabel('🛑 Forçar Desconexão').setStyle(ButtonStyle.Danger)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

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
    const telefone = interaction.customId.replace('entrar_', '');
    if (estadoTelefones[telefone]) {
      const r = await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: new Date() };
    if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
    atendimentosAtivos.get(user.id).push(telefone);

    await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
    await atualizarPainel();

    const r = await interaction.reply({ content: `📞 Conectado ao telefone ${telefone}`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== DESCONECTAR TODOS ===== */
  if (interaction.isButton() && interaction.customId === 'sair_todos') {
    const r = await interaction.reply({ content: '📴 Desconectando...', ephemeral: true });

    const lista = atendimentosAtivos.get(user.id) || [];
    for (const tel of lista) {
      const dados = estadoTelefones[tel];
      if (dados) {
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }
    }

    atendimentosAtivos.delete(user.id);
    await atualizarPainel();

    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== DESCONECTAR UM ===== */
  if (interaction.isButton() && interaction.customId === 'sair_um') {
    const lista = atendimentosAtivos.get(user.id) || [];
    if (!lista.length) {
      const r = await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_sair_um')
      .setPlaceholder('Escolha o telefone')
      .addOptions(lista.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '🟠 Qual telefone deseja desconectar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_sair_um') {
    const tel = interaction.values[0];
    const dados = estadoTelefones[tel];

    if (dados) {
      await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
      delete estadoTelefones[tel];
    }

    atendimentosAtivos.get(interaction.user.id)?.splice(
      atendimentosAtivos.get(interaction.user.id).indexOf(tel), 1
    );

    await atualizarPainel();
    await interaction.update({ content: `📴 Telefone ${tel} desconectado`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== FORÇAR ===== */
  if (interaction.isButton() && interaction.customId === 'forcar') {
    const ocupados = Object.keys(estadoTelefones);
    if (!ocupados.length) {
      const r = await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_forcar')
      .setPlaceholder('Selecione o telefone')
      .addOptions(ocupados.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '🛑 Qual telefone deseja forçar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_forcar') {
    const tel = interaction.values[0];
    const dados = estadoTelefones[tel];

    if (dados) {
      await registrarEvento(tel, `🛑 ${hora()} — Desconectado à força`);
      delete estadoTelefones[tel];
      atendimentosAtivos.get(dados.userId)?.splice(
        atendimentosAtivos.get(dados.userId).indexOf(tel), 1
      );
    }

    await atualizarPainel();
    await interaction.update({ content: `🛑 Telefone ${tel} forçado`, components: [] });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot online'));
app.listen(PORT);
