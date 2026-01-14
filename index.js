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

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= CONFIG ================= */
const canalPainelId = '1414723351125033190';
const canalRelatorioId = '1458539184452276336';
const TOKEN = process.env.TOKEN;
const CARGO_TRANSFERENCIA = '.';

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
function apagar(interaction, ms = 3000) {
  setTimeout(() => interaction.deleteReply().catch(()=>{}), ms);
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
  setInterval(atualizarPainel, 5 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  /* ===== ENTRAR ===== */
  if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
    const telefone = interaction.customId.replace('entrar_', '');
    if (estadoTelefones[telefone]) {
      await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
      return apagar(interaction);
    }

    estadoTelefones[telefone] = { userId: user.id, nome: user.username };
    if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
    atendimentosAtivos.get(user.id).push(telefone);

    await atualizarPainel();
    await interaction.reply({ content: `📞 Conectado ao telefone **${telefone}**`, ephemeral: true });
    return apagar(interaction);
  }

  /* ===== SAIR TODOS ===== */
  if (interaction.isButton() && interaction.customId === 'sair_todos') {
    const lista = atendimentosAtivos.get(user.id) || [];
    lista.forEach(t => delete estadoTelefones[t]);
    atendimentosAtivos.delete(user.id);

    await atualizarPainel();
    await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
    return apagar(interaction);
  }

  /* ===== SAIR UM ===== */
  if (interaction.isButton() && interaction.customId === 'sair_um') {
    const lista = atendimentosAtivos.get(user.id) || [];
    if (!lista.length) {
      await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
      return apagar(interaction);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_sair')
      .setPlaceholder('Escolha o telefone')
      .addOptions(lista.map(t => ({ label: t, value: t })));

    return interaction.reply({
      ephemeral: true,
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  /* ===== TRANSFERIR ===== */
  if (interaction.isButton() && interaction.customId === 'transferir') {
    const menu = new UserSelectMenuBuilder()
      .setCustomId('menu_transferir')
      .setPlaceholder('Escolha o telefonista');

    return interaction.reply({
      ephemeral: true,
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  /* ===== FORÇAR ===== */
  if (interaction.isButton() && interaction.customId === 'forcar') {
    const ocupados = Object.entries(estadoTelefones);
    if (!ocupados.length) {
      await interaction.reply({ content: '⚠️ Nenhum telefone ocupado.', ephemeral: true });
      return apagar(interaction);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_forcar')
      .setPlaceholder('Escolha o telefone')
      .addOptions(ocupados.map(([t, d]) => ({
        label: `${d.nome} (${t})`,
        value: t
      })));

    return interaction.reply({
      ephemeral: true,
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  /* ===== MENUS ===== */
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'menu_sair') {
      const tel = interaction.values[0];
      delete estadoTelefones[tel];
      atendimentosAtivos.get(user.id)?.splice(
        atendimentosAtivos.get(user.id).indexOf(tel), 1
      );
      await atualizarPainel();
      await interaction.reply({ content: `📴 Saiu do telefone ${tel}`, ephemeral: true });
      return apagar(interaction);
    }

    if (interaction.customId === 'menu_forcar') {
      const tel = interaction.values[0];
      delete estadoTelefones[tel];
      await atualizarPainel();
      await interaction.reply({ content: `🛑 Desconexão forçada no ${tel}`, ephemeral: true });
      return apagar(interaction);
    }
  }

  if (interaction.isUserSelectMenu() && interaction.customId === 'menu_transferir') {
    const membro = interaction.members.first();
    if (!membro.roles.cache.some(r => r.name === CARGO_TRANSFERENCIA)) {
      await interaction.reply({ content: '❌ Usuário sem permissão.', ephemeral: true });
      return apagar(interaction);
    }

    await interaction.reply({ content: `🔄 Transferência para ${membro.user.username}`, ephemeral: true });
    return apagar(interaction);
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
