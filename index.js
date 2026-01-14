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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= CONFIG ================= */
const canalPainelId = '1414723351125033190';
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

  /* ===== TRANSFERIR ===== */
if (interaction.isButton() && interaction.customId === 'transferir') {
  const meusTelefones = atendimentosAtivos.get(user.id) || [];
  if (!meusTelefones.length) {
    await interaction.reply({ content: '⚠️ Você não está em nenhum telefone.', ephemeral: true });
    return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  const menuTelefone = new StringSelectMenuBuilder()
    .setCustomId('transferir_tel')
    .setPlaceholder('Escolha o telefone')
    .addOptions(meusTelefones.map(t => ({ label: t, value: t })));

  await interaction.reply({
    content: '🔵 Qual telefone deseja transferir?',
    components: [new ActionRowBuilder().addComponents(menuTelefone)],
    ephemeral: true
  });
}

if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
  const telefone = interaction.values[0];
  const guild = interaction.guild;

  const membros = await guild.members.fetch();
  const elegiveis = membros.filter(m =>
    m.roles.cache.some(r => r.name === '.') &&
    !m.user.bot
  );

  if (!elegiveis.size) {
    await interaction.reply({ content: '⚠️ Nenhum usuário elegível.', ephemeral: true });
    return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  const menuUsuarios = new StringSelectMenuBuilder()
    .setCustomId(`transferir_user_${telefone}`)
    .setPlaceholder('Escolha o telefonista')
    .addOptions(
      elegiveis.map(m => ({
        label: m.user.username,
        value: m.id
      })).slice(0, 25)
    );

  await interaction.reply({
    content: `👤 Para quem deseja transferir **${telefone}**?`,
    components: [new ActionRowBuilder().addComponents(menuUsuarios)],
    ephemeral: true
  });

  setTimeout(() => interaction.deleteReply().catch(()=>{}), 15000);
}

if (interaction.isStringSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
  const telefone = interaction.customId.replace('transferir_user_', '');
  const novoUserId = interaction.values[0];

  const antigo = estadoTelefones[telefone];
  if (!antigo) return;

  // remove do antigo
  atendimentosAtivos.get(antigo.userId)?.splice(
    atendimentosAtivos.get(antigo.userId).indexOf(telefone), 1
  );

  // adiciona ao novo
  const membro = await interaction.guild.members.fetch(novoUserId);
  estadoTelefones[telefone] = {
    userId: novoUserId,
    nome: membro.user.username,
    entrada: Date.now()
  };

  if (!atendimentosAtivos.has(novoUserId)) atendimentosAtivos.set(novoUserId, []);
  atendimentosAtivos.get(novoUserId).push(telefone);

  await atualizarPainel();

  await interaction.reply({
    content: `🔄 Telefone **${telefone}** transferido para **${membro.user.username}**`,
    ephemeral: true
  });

  setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
}

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
