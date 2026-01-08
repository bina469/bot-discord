const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
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
  'Sophia','Ingrid','Valentina','Melissa'
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
    console.error("⚠️ Erro ao atualizar relatório:", e);
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
        new ButtonBuilder().setCustomId('forcar_desconectar').setLabel('🛑 Forçar Desconexão').setStyle(ButtonStyle.Danger)
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
    console.error("⚠️ Erro ao atualizar painel:", e);
  }
}

/* ================= BOT ================= */
client.once('ready', async () => {
  console.log('🚀 Bot online e painel ativo');

  mensagemPainelId = null;
  mensagemRelatorioId = null;

  await atualizarPainel();
  await atualizarRelatorio();

  setInterval(atualizarPainel, 5 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  try {
    /* ===== CONECTAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[telefone]) {
        await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }
      estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: new Date() };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();

      await interaction.reply({ content: `📞 Conectado ao telefone **${telefone}**`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
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

      await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    /* ===== SAIR UM ===== */
    if (interaction.isButton() && interaction.customId === 'sair_um') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }
      const tel = lista.pop();
      const dados = estadoTelefones[tel];
      if (dados) {
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }
      await atualizarPainel();
      await interaction.reply({ content: `📴 Desconectado do telefone **${tel}**`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    /* ===== TRANSFERIR ===== */
    if (interaction.isButton() && interaction.customId === 'transferir') {
      await interaction.reply({ content: '🔄 Transferência selecionada (implementação extra necessária)', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    /* ===== FORÇAR DESCONECTAR ===== */
    if (interaction.isButton() && interaction.customId === 'forcar_desconectar') {
      for (const tel of Object.keys(estadoTelefones)) {
        const dados = estadoTelefones[tel];
        await registrarEvento(tel, `🛑 ${hora()} — ${dados.nome} foi desconectado à força`);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.clear();
      await atualizarPainel();
      await interaction.reply({ content: '🛑 Todos os telefones foram desconectados à força', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

  } catch(e) {
    console.error("💥 Erro na interação:", e);
  }
});

client.login(TOKEN);

/* ================= EXPRESS PARA RENDER ================= */
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot está online ✅'));
app.listen(PORT, () => console.log(`🌐 Servidor web rodando na porta ${PORT}`));
