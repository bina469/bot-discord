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

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  /* ===== ENTRAR ===== */
  if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
    const tel = interaction.customId.replace('entrar_', '');
    if (estadoTelefones[tel]) {
      return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
    }

    estadoTelefones[tel] = { userId: user.id, nome: user.username, entrada: new Date() };
    if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
    atendimentosAtivos.get(user.id).push(tel);

    await registrarEvento(tel, `🟢 ${hora()} — ${user.username} conectou`);
    await atualizarPainel();
    return interaction.reply({ content: `📞 Conectado ao telefone ${tel}`, ephemeral: true });
  }

  /* ===== DESCONCTAR TODOS (FIX) ===== */
  if (interaction.isButton() && interaction.customId === 'sair_todos') {
    await interaction.deferReply({ ephemeral: true });

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

    return interaction.editReply('📴 Desconectado de todos os telefones');
  }

  /* ===== TRANSFERIR (POR TELEFONISTA) ===== */
  if (interaction.isButton() && interaction.customId === 'transferir') {
    const lista = atendimentosAtivos.get(user.id) || [];
    if (!lista.length) {
      return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_transferir_tel')
      .setPlaceholder('Selecione o telefone')
      .addOptions(lista.map(t => ({ label: t, value: t })));

    return interaction.reply({
      content: '🔄 Qual telefone deseja transferir?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_transferir_tel') {
    const tel = interaction.values[0];

    const menu = new UserSelectMenuBuilder()
      .setCustomId(`menu_transferir_user|${tel}`)
      .setPlaceholder('Selecione o telefonista');

    return interaction.update({
      content: '👤 Para qual telefonista?',
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  if (interaction.isUserSelectMenu() && interaction.customId.startsWith('menu_transferir_user')) {
    const tel = interaction.customId.split('|')[1];
    const novoUserId = interaction.values[0];
    const dados = estadoTelefones[tel];

    if (!dados) return;

    atendimentosAtivos.get(dados.userId)?.splice(
      atendimentosAtivos.get(dados.userId).indexOf(tel), 1
    );

    estadoTelefones[tel] = {
      userId: novoUserId,
      nome: `<@${novoUserId}>`,
      entrada: dados.entrada
    };

    if (!atendimentosAtivos.has(novoUserId)) atendimentosAtivos.set(novoUserId, []);
    atendimentosAtivos.get(novoUserId).push(tel);

    await registrarEvento(tel, `🔁 ${hora()} — Transferido para <@${novoUserId}>`);
    await atualizarPainel();

    return interaction.update({ content: '🔁 Transferência concluída', components: [] });
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
