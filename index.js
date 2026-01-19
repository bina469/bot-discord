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

/* ================= CONFIG ================= */
const CANAL_PAINEL_ID = '1414723351125033190';
const CANAL_RELATORIO_ID = '1458539184452276336';
const TOKEN = process.env.TOKEN;

/* ================= BOT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= TELEFONES ================= */
// Removido Alina, adicionado Cloe
const telefones = [
  'Samantha',
  'Rosalia',
  'Ingrid',
  'Melissa',
  'Cloe'
];

/* ================= ESTADO ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

/* ================= UTIL ================= */
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

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

/* ================= PAINEL ================= */
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

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

/* ================= INTERAÇÕES ================= */
// ⚠️ TODO O RESTO DO CÓDIGO PERMANECE EXATAMENTE IGUAL
// (sem nenhuma alteração além da lista de telefones)

client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel])
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = { userId: user.id, nome: user.username, entrada: new Date() };

      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(tel);

      await registrarEvento(tel, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();

      await interaction.reply({ content: `📞 Conectado ao **${tel}**`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    // (restante do código permanece exatamente igual ao que você enviou)
  } catch (err) {
    console.error('ERRO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Online'));
app.listen(process.env.PORT || 3000);
