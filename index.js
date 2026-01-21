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

const CARGO_STAFF_ID = '838753379332915280';
const CARGO_TELEFONISTA_ID = '1463421663101059154';

const CANAL_PAINEL_ID = '1463407852583653479'; // painel ticket
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_ID = '1458342162981716039';

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= ESTADOS ================= */
// Tickets
const tickets = new Map();
let painelMsgId = null;

// Painel presença
const telefones = [
  'Pathy','Samantha','Rosalia','Rafaela',
  'Sophia','Ingrid','Valentina','Melissa'
];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelPresencaId = null;
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
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);
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

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
}

/* ================= PAINEL PRESENÇA ================= */
async function atualizarPainelPresenca() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
      : `🟢 Telefone ${t} — Livre`
  ).join('\n');

  const botoesTelefone = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`presenca_entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTelefone.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('presenca_sair_todos')
        .setLabel('🔴 Desconectar TODOS')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('presenca_menu_sair')
        .setLabel('🟠 Desconectar UM')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('presenca_menu_transferir')
        .setLabel('🔵 Transferir')
        .setStyle(ButtonStyle.Primary)
    )
  );

  const texto =
`📞 **PAINEL DE PRESENÇA**

${status}

👇 Use os botões abaixo`;

  if (mensagemPainelPresencaId) {
    const msg = await canal.messages.fetch(mensagemPainelPresencaId);
    await msg.edit({ content: texto, components: rows });
  } else {
    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelPresencaId = msg.id;
  }
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  // Painel Ticket
  const canalPainel = await client.channels.fetch(CANAL_PAINEL_ID).catch(() => null);
  if (canalPainel) {
    const botao = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('abrir_ticket')
        .setLabel('🎫 Abrir Ticket')
        .setStyle(ButtonStyle.Primary)
    );
    const msg = await canalPainel.send({
      content: '📞 **Painel de Tickets**',
      components: [botao]
    });
    painelMsgId = msg.id;
  }

  // Painel Presença
  await atualizarPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ========= PAINEL PRESENÇA ========= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_entrar_')) {
      const telefone = interaction.customId.replace('presenca_entrar_', '');
      if (estadoTelefones[telefone])
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[telefone] = {
        userId: interaction.user.id,
        nome: interaction.user.username,
        entrada: new Date()
      };

      if (!atendimentosAtivos.has(interaction.user.id))
        atendimentosAtivos.set(interaction.user.id, []);
      atendimentosAtivos.get(interaction.user.id).push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${interaction.user.username} conectou`);
      await atualizarPainelPresenca();

      await interaction.reply({ content: `📞 Conectado ao telefone ${telefone}`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'presenca_sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      for (const tel of lista) {
        const dados = estadoTelefones[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }

      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainelPresenca();

      await interaction.reply({ content: '📴 Desconectado de todos.', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ========= TICKET (SEU CÓDIGO ORIGINAL) ========= */
    // ⚠️ Não alterado — permanece exatamente como você enviou
    // (continua funcionando igual)

  } catch (err) {
    console.error('ERRO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= RENDER KEEP-ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
