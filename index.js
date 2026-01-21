const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

const CANAL_PAINEL_ID = '1463407852583653479';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_STAFF_ID = '838753379332915280';
const CARGO_TELEFONISTA_ID = '1463421663101059154';

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha','Rosalia','Ingrid','Melissa','Cloe'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let painelMsgId = null;

/* ================= TICKET ================= */
const tickets = new Map();

/* ================= UTIL ================= */
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

/* ================= RELATÓRIO ================= */
async function registrarEvento(tel, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][tel]) relatorioDiario[data][tel] = [];
  relatorioDiario[data][tel].push(texto);

  const canal = await client.channels.fetch(CANAL_RELATORIO_ID).catch(() => null);
  if (!canal) return;

  let msg = `📅 **RELATÓRIO — ${data}**\n\n`;
  for (const t in relatorioDiario[data]) {
    msg += `📞 **${t}**\n${relatorioDiario[data][t].join('\n')}\n\n`;
  }

  canal.bulkDelete(5, true).catch(() => {});
  canal.send(msg);
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_ID).catch(() => null);
  if (!canal) return;

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
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
    new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('forcar_desconectar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Danger)
  ));

  if (painelMsgId) {
    const msg = await canal.messages.fetch(painelMsgId).catch(() => null);
    if (msg) return msg.edit({ content: status, components: rows });
  }

  const msg = await canal.send({ content: status, components: rows });
  painelMsgId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== CONECTAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel])
        return interaction.reply({ content: 'Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username,
        entrada: new Date()
      };

      if (!atendimentosAtivos.has(interaction.user.id))
        atendimentosAtivos.set(interaction.user.id, []);
      atendimentosAtivos.get(interaction.user.id).push(tel);

      await registrarEvento(tel, `🟢 ${hora()} — ${interaction.user.username} conectou`);
      await atualizarPainel();
      return interaction.reply({ content: `Conectado em ${tel}`, ephemeral: true });
    }

    /* ===== MENU DESCONECTAR UM ===== */
    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      if (!lista.length)
        return interaction.reply({ content: 'Nenhum telefone ativo.', ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const tel = interaction.values[0];
      const d = estadoTelefones[tel];

      await registrarEvento(tel, `🔴 ${hora()} — ${d.nome} saiu (${tempo(d.entrada)})`);
      delete estadoTelefones[tel];
      atendimentosAtivos.set(interaction.user.id,
        atendimentosAtivos.get(interaction.user.id).filter(t => t !== tel)
      );

      await atualizarPainel();
      return interaction.update({ content: `${tel} desconectado.`, components: [] });
    }

    /* ===== FORÇAR DESCONECTAR ===== */
    if (interaction.isButton() && interaction.customId === 'forcar_desconectar') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return interaction.reply({ content: 'Apenas staff.', ephemeral: true });

      const ativos = Object.keys(estadoTelefones);
      if (!ativos.length)
        return interaction.reply({ content: 'Nenhum telefone ativo.', ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_menu')
        .setPlaceholder('Telefone para forçar')
        .addOptions(ativos.map(t => ({
          label: `${t} — ${estadoTelefones[t].nome}`,
          value: t
        })));

      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_menu') {
      const tel = interaction.values[0];
      const d = estadoTelefones[tel];

      await registrarEvento(
        tel,
        `⚠️ ${hora()} — ${d.nome} foi desconectado forçadamente por ${interaction.user.username}`
      );

      delete estadoTelefones[tel];
      atendimentosAtivos.set(d.userId,
        (atendimentosAtivos.get(d.userId) || []).filter(t => t !== tel)
      );

      await atualizarPainel();
      return interaction.update({ content: `${tel} desconectado à força.`, components: [] });
    }

  } catch (e) {
    console.error(e);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Online'));
app.listen(process.env.PORT || 3000);
