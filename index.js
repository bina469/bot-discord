const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  InteractionResponseFlags
} = require('discord.js');

const express = require('express'); // Para o Render não fechar
const app = express();
app.get('/', (req, res) => res.send('Bot rodando!'));
app.listen(process.env.PORT || 10000);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

require('dotenv').config();
const TOKEN = process.env.TOKEN;

const canalPainelId = '1414723351125033190';
const canalRelatorioId = '1458539184452276336';

const telefones = ['Pathy','Samantha','Rosalia','Rafaela','Sophia','Ingrid','Valentina','Melissa'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};

let mensagemPainelId = null;
let mensagemRelatorioId = null;

// Utilitários
function hoje() { return new Date().toLocaleDateString('pt-BR'); }
function hora() { return new Date().toLocaleTimeString('pt-BR'); }
function tempo(entrada) {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

// Relatório
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(canalRelatorioId);
  const data = hoje();
  if (!relatorioDiario[data]) return;

  let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;
  for (const tel of Object.keys(relatorioDiario[data])) {
    texto += `📞 **Telefone ${tel}**\n${relatorioDiario[data][tel].join('\n')}\n----------------------\n`;
  }

  try {
    if (mensagemRelatorioId) {
      const msg = await canal.messages.fetch(mensagemRelatorioId);
      await msg.edit(texto);
    } else {
      const msg = await canal.send(texto);
      mensagemRelatorioId = msg.id;
    }
  } catch {
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

// Painel
async function atualizarPainel() {
  const canal = await client.channels.fetch(canalPainelId);

  const status = telefones.map(t =>
    estadoTelefones[t] ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}` : `🟢 Telefone ${t} — Livre`
  ).join('\n');

  const botoesTelefone = telefones.map(t =>
    new ButtonBuilder().setCustomId(`entrar_${t}`).setLabel(`📞 ${t}`).setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTelefone.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 5)));
  }

  // Botões administrativos
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('forcar_desconectar').setLabel('🛑 Forçar Desconexão').setStyle(ButtonStyle.Danger)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

  try {
    if (mensagemPainelId) {
      const msg = await canal.messages.fetch(mensagemPainelId);
      await msg.edit({ content: texto, components: rows });
    } else {
      const msg = await canal.send({ content: texto, components: rows });
      mensagemPainelId = msg.id;
    }
  } catch {
    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;
  }
}

// Bot
client.once('ready', async () => {
  console.log('🚀 Bot online e painel ativo');
  mensagemPainelId = null;
  mensagemRelatorioId = null;

  await atualizarPainel();
  await atualizarRelatorio();

  setInterval(atualizarPainel, 5 * 60 * 1000);
});

// Interações
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  const flagsEphemeral = { flags: 64 }; // Substitui ephemeral:true

  // Botões de telefone
  if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
    const telefone = interaction.customId.replace('entrar_', '');
    if (estadoTelefones[telefone])
      return interaction.reply({ content: '⚠️ Telefone ocupado.', ...flagsEphemeral });

    estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: new Date() };
    if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
    atendimentosAtivos.get(user.id).push(telefone);

    await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
    await atualizarPainel();

    await interaction.reply({ content: `📞 Conectado ao telefone **${telefone}**`, ...flagsEphemeral });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
  }

  // O restante dos botões e menus deve usar a mesma estratégia: sempre **flags: 64** para efêmero
  // e atualizarPainel() depois de qualquer mudança
});

client.login(TOKEN);
