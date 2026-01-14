const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const express = require('express');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ================= CONFIG ================= */
const canalPainelId = '1414723351125033190';
const canalRelatorioId = '1458539184452276336';
const TOKEN = process.env.TOKEN;
const CARGO_TELEFONISTA = '.';

/* ================= TELEFONES ================= */
const telefones = [
  'Pathy','Samantha','Rosalia','Rafaela',
  'Sophia','Ingrid','Valentina','Melissa','Alina'
];

/* ================= ESTADO ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const transferenciasPendentes = new Map();
let mensagemPainelId = null;

/* ================= UTIL ================= */
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

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
  for (let i = 0; i < botoes.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sair_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary)
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

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== TRANSFERIR ===== */
    if (interaction.isButton() && interaction.customId === 'transferir') {
      const ocupados = Object.keys(estadoTelefones);
      if (!ocupados.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
        setTimeout(() => interaction.deleteReply(), 3000);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(ocupados.map(t => ({ label: t, value: t })));

      await interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }

    /* ===== TELEFONE ESCOLHIDO ===== */
    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      const telefone = interaction.values[0];
      transferenciasPendentes.set(interaction.user.id, telefone);

      const membros = interaction.guild.members.cache
        .filter(m => m.roles.cache.some(r => r.name === CARGO_TELEFONISTA))
        .map(m => ({ label: m.user.username, value: m.id }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_user')
        .setPlaceholder('Escolha o telefonista')
        .addOptions(membros);

      await interaction.update({
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }

    /* ===== FINALIZA TRANSFERÊNCIA ===== */
    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_user') {
      const telefone = transferenciasPendentes.get(interaction.user.id);
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);

      estadoTelefones[telefone] = {
        userId: novoId,
        nome: novoUser.username,
        entrada: new Date()
      };

      transferenciasPendentes.delete(interaction.user.id);
      await atualizarPainel();

      await interaction.update({ components: [] });
      setTimeout(() => interaction.deleteReply(), 3000);
    }

  } catch (e) {
    console.error('Erro:', e);
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Online'));
app.listen(process.env.PORT || 3000);
