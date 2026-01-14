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
async function atualizarRelatorio() {
  try {
    const canal = await client.channels.fetch(canalRelatorioId);
    const data = hoje();
    if (!relatorioDiario[data]) return;

    let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;
    for (const tel of Object.keys(relatorioDiario[data])) {
      texto += `📞 **Telefone ${tel}**\n`;
      texto += relatorioDiario[data][tel].join('\n');
      texto += `\n----------------------\n`;
    }

    if (mensagemRelatorioId) {
      try {
        const msg = await canal.messages.fetch(mensagemRelatorioId);
        await msg.edit(texto);
      } catch {
        const msg = await canal.send(texto);
        mensagemRelatorioId = msg.id;
      }
    } else {
      const msg = await canal.send(texto);
      mensagemRelatorioId = msg.id;
    }
  } catch (e) {
    console.error("⚠️ Erro relatório:", e);
  }
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
  try {
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
  } catch (e) {
    console.error("⚠️ Erro painel:", e);
  }
}

/* ================= BOT ================= */
client.once('ready', async () => {
  console.log('🚀 Bot online');
  await atualizarPainel();
  await atualizarRelatorio();
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

  /* ===== DESCON. UM ===== */
  if (interaction.isButton() && interaction.customId === 'sair_um') {
    const lista = atendimentosAtivos.get(user.id) || [];
    if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_sair_um')
      .setPlaceholder('Selecione o telefone')
      .addOptions(lista.map(t => ({ label: t, value: t })));

    return interaction.reply({
      content: '📴 Escolha o telefone:',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_sair_um') {
    const tel = interaction.values[0];
    const dados = estadoTelefones[tel];
    await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
    delete estadoTelefones[tel];

    atendimentosAtivos.set(
      user.id,
      atendimentosAtivos.get(user.id).filter(t => t !== tel)
    );

    await atualizarPainel();
    return interaction.update({ content: `📴 Desconectado de ${tel}`, components: [] });
  }

  /* ===== TRANSFERIR ===== */
  if (interaction.isButton() && interaction.customId === 'transferir') {
    const lista = atendimentosAtivos.get(user.id) || [];
    if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_transferir_origem')
      .setPlaceholder('Telefone de origem')
      .addOptions(lista.map(t => ({ label: t, value: t })));

    return interaction.reply({
      content: '🔄 Escolha o telefone de origem:',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_transferir_origem') {
    const origem = interaction.values[0];
    const livres = telefones.filter(t => !estadoTelefones[t]);

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`menu_transferir_destino|${origem}`)
      .setPlaceholder('Telefone de destino')
      .addOptions(livres.map(t => ({ label: t, value: t })));

    return interaction.update({
      content: '🔄 Escolha o destino:',
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('menu_transferir_destino')) {
    const origem = interaction.customId.split('|')[1];
    const destino = interaction.values[0];

    estadoTelefones[destino] = estadoTelefones[origem];
    delete estadoTelefones[origem];

    await registrarEvento(origem, `🔁 ${hora()} — Transferido para ${destino}`);
    await atualizarPainel();

    return interaction.update({ content: '🔁 Transferência concluída', components: [] });
  }

  /* ===== FORÇAR ===== */
  if (interaction.isButton() && interaction.customId === 'forcar') {
    const ocupados = Object.keys(estadoTelefones);
    if (!ocupados.length) return interaction.reply({ content: '⚠️ Nenhum telefone ocupado.', ephemeral: true });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('menu_forcar')
      .setPlaceholder('Escolha o telefone')
      .addOptions(ocupados.map(t => ({ label: t, value: t })));

    return interaction.reply({
      content: '🛑 Escolha o telefone para forçar:',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'menu_forcar') {
    const tel = interaction.values[0];
    const dados = estadoTelefones[tel];

    await registrarEvento(tel, `🛑 ${hora()} — ${dados.nome} desconectado à força`);
    delete estadoTelefones[tel];
    atendimentosAtivos.delete(dados.userId);

    await atualizarPainel();
    return interaction.update({ content: '🛑 Desconexão forçada', components: [] });
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
