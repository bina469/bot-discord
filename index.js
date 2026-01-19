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
// Remove Pathy da lista
const telefones = [
  'Samantha',
  'Rosalia',
  'Ingrid',
  'Melissa',
  'Alina'
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

  // Adiciona botão de forçar desconexão
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
client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    // ===== ENTRAR TELEFONE =====
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

    // ===== DESCONECTAR TODOS =====
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      await interaction.deferReply({ ephemeral: true });

      const lista = atendimentosAtivos.get(user.id) || [];
      for (const tel of lista) {
        const d = estadoTelefones[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${d.nome} saiu (${tempo(d.entrada)})`);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.delete(user.id);
      await atualizarPainel();

      await interaction.editReply({ content: '📴 Desconectado de todos.' });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    // ===== MENU DESCONECTAR UM =====
    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length)
        return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.editReply({ components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // ===== DESCONECTAR UM =====
    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      await interaction.deferUpdate();
      const tel = interaction.values[0];
      const d = estadoTelefones[tel];

      await registrarEvento(tel, `🔴 ${hora()} — ${d.nome} saiu (${tempo(d.entrada)})`);
      delete estadoTelefones[tel];

      atendimentosAtivos.set(user.id, atendimentosAtivos.get(user.id).filter(t => t !== tel));
      await atualizarPainel();

      await interaction.editReply({ content: `✅ ${tel} desconectado.`, components: [] });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    // ===== MENU TRANSFERIR =====
    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length)
        return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.editReply({ components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // ===== ESCOLHER TELEFONE PARA TRANSFERIR =====
    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      await interaction.deferUpdate();
      const tel = interaction.values[0];

      const menuUser = new UserSelectMenuBuilder()
        .setCustomId(`transferir_user_${tel}`)
        .setPlaceholder('Escolha o novo telefonista')
        .setMaxValues(1)
        .setMinValues(1);

      return interaction.editReply({ components: [new ActionRowBuilder().addComponents(menuUser)] });
    }

    // ===== TRANSFERIR TELEFONE =====
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
      await interaction.deferUpdate();
      const tel = interaction.customId.replace('transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = estadoTelefones[tel];

      await registrarEvento(
        tel,
        `🔁 ${hora()} — ${antigo.nome} transferiu para ${novoUser.username} (${tempo(antigo.entrada)})`
      );

      estadoTelefones[tel] = { userId: novoId, nome: novoUser.username, entrada: new Date() };

      atendimentosAtivos.set(
        antigo.userId,
        atendimentosAtivos.get(antigo.userId).filter(t => t !== tel)
      );

      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(tel);

      await atualizarPainel();

      await interaction.editReply({
        content: `✅ ${tel} transferido para **${novoUser.username}**.`,
        components: []
      });

      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    // ===== FORÇAR DESCONECTAR =====
    if (interaction.isButton() && interaction.customId === 'forcar_desconectar') {
      await interaction.deferReply({ ephemeral: true });

      const conectados = Object.keys(estadoTelefones);
      if (!conectados.length)
        return interaction.editReply({ content: '⚠️ Nenhum telefone conectado.', components: [] });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_desconectar_menu')
        .setPlaceholder('Escolha o telefone para forçar desconexão')
        .addOptions(conectados.map(t => ({ label: `${t} — ${estadoTelefones[t].nome}`, value: t })));

      return interaction.editReply({ components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // ===== EXECUTAR FORÇAR DESCONECTAR =====
    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_desconectar_menu') {
      await interaction.deferUpdate();
      const tel = interaction.values[0];
      const d = estadoTelefones[tel];

      await registrarEvento(tel, `⚠️ ${hora()} — ${d.nome} foi desconectado forçadamente.`);
      delete estadoTelefones[tel];

      // Remove do mapa de atendimentos ativos
      atendimentosAtivos.set(d.userId, atendimentosAtivos.get(d.userId).filter(t => t !== tel));
      await atualizarPainel();

      await interaction.editReply({ content: `✅ ${tel} desconectado forçadamente.`, components: [] });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

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
