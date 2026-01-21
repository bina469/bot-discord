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
const TOKEN = process.env.TOKEN;

// PAINEL PRESENÇA
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// TELEFONES
const telefones = ['Samantha', 'Katherine', 'Rosalia', 'Ingrid'];

/* ================= BOT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

/* ================= ESTADO ================= */
const estadoTelefones = {}; // telefone -> { userId, nome, entrada }
const atendimentosAtivos = new Map(); // userId -> [telefones]
const relatorioDiario = {}; // data -> telefone -> eventos
let mensagemPainelId = null;
let mensagemRelatorioId = null;

/* ================= UTIL ================= */
function hoje() {
  return new Date().toLocaleDateString('pt-BR');
}
function hora() {
  return new Date().toLocaleTimeString('pt-BR');
}
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
  await atualizarRelatorio();
}

async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_PRESENCA_ID);
  const data = hoje();
  if (!relatorioDiario[data]) return;

  let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;

  for (const tel of Object.keys(relatorioDiario[data])) {
    texto += `📞 **Telefone ${tel}**\n`;
    texto += relatorioDiario[data][tel].join('\n');
    texto += `\n----------------------\n`;
  }

  if (mensagemRelatorioId) {
    const msg = await canal.messages.fetch(mensagemRelatorioId);
    await msg.edit(texto);
  } else {
    const msg = await canal.send(texto);
    mensagemRelatorioId = msg.id;
  }
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

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

  // Botões de ação
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sair_todos')
        .setLabel('🔴 Desconectar TODOS')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('menu_sair')
        .setLabel('🟠 Desconectar UM')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('menu_transferir')
        .setLabel('🔵 Transferir')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('forcar_desconexao')
        .setLabel('⚠️ Forçar')
        .setStyle(ButtonStyle.Danger)
    )
  );

  const texto =
`📞 **PAINEL DE PRESENÇA**

${status}

👇 Use os botões abaixo`;

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId);
    await msg.edit({ content: texto, components: rows });
  } else {
    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;
  }
}

/* ================= BOT ================= */
client.once('clientReady', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    // Apenas botões por enquanto
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;

    // Corrigido: deferReply com ephemeral correto
    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });
    }

    /* ===== CONECTAR TELEFONE ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[telefone]) {
        return interaction.editReply('⚠️ Telefone ocupado.');
      }

      estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: Date.now() };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();

      await interaction.editReply(`📞 Conectado ao telefone **${telefone}**`);
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    /* ===== DESCONECTAR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];
      for (const tel of lista) {
        const dados = estadoTelefones[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.delete(user.id);
      await atualizarPainel();
      await interaction.editReply('📴 Desconectado de todos os telefones');
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    // Os menus ("Desconectar um", "Transferir", "Forçar") podemos implementar na próxima iteração
  } catch (err) {
    console.error('ERRO PAINEL:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('⚠️ Ocorreu um erro ao processar a ação.');
    } else {
      await interaction.reply({ content: '⚠️ Ocorreu um erro ao processar a ação.', ephemeral: true });
    }
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
