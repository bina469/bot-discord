const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');

const express = require('express'); // Para manter o serviço online no Render
const app = express();
const PORT = process.env.PORT || 10000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= CONFIG ================= */
const canalPainelId = '1414723351125033190';
const canalRelatorioId = '1458539184452276336';
require('dotenv').config();
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
      const msg = await canal.messages.fetch(mensagemRelatorioId).catch(() => null);
      if (msg) {
        await msg.edit(texto);
      } else {
        const nova = await canal.send(texto);
        mensagemRelatorioId = nova.id;
      }
    } else {
      const nova = await canal.send(texto);
      mensagemRelatorioId = nova.id;
    }
  } catch(err) {
    console.error('Erro ao atualizar relatório:', err);
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
        new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('forcar_desconectar').setLabel('🛑 Forçar Desconexão').setStyle(ButtonStyle.Danger)
      )
    );

    const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

    if (mensagemPainelId) {
      const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
      if (msg) {
        await msg.edit({ content: texto, components: rows });
      } else {
        const nova = await canal.send({ content: texto, components: rows });
        mensagemPainelId = nova.id;
      }
    } else {
      const nova = await canal.send({ content: texto, components: rows });
      mensagemPainelId = nova.id;
    }
  } catch(err) {
    console.error('Erro ao atualizar painel:', err);
  }
}

/* ================= BOT ================= */
client.once('ready', async () => {
  console.log('🚀 Iniciando bot...');

  mensagemPainelId = null;
  mensagemRelatorioId = null;

  await atualizarPainel();
  await atualizarRelatorio();

  setInterval(async () => {
    await atualizarPainel();
  }, 5 * 60 * 1000);

  console.log('✅ Bot online e painel ativo');
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    /* ===== CONECTAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[telefone]) {
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
      }
      estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: new Date() };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);
      await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();
      return interaction.reply({ content: `📞 Conectado ao telefone **${telefone}**`, ephemeral: true });
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];
      for (const tel of lista) {
        const dados = estadoTelefones[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.delete(user.id);
      await atualizarPainel();
      return interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
    }

    /* ===== MENU SAIR UM ===== */
    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (lista.length === 0) return interaction.reply({ content: '⚠️ Você não está conectado em nenhum telefone.', ephemeral: true });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const telefone = interaction.values[0];
      const dados = estadoTelefones[telefone];
      await registrarEvento(telefone, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
      delete estadoTelefones[telefone];
      atendimentosAtivos.set(user.id, atendimentosAtivos.get(user.id).filter(t => t !== telefone));
      await atualizarPainel();
      return interaction.update({ content: `✅ Telefone **${telefone}** desconectado.`, components: [] });
    }

    /* ===== MENU TRANSFERIR ===== */
    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (lista.length === 0) return interaction.reply({ content: '⚠️ Você não está conectado em nenhum telefone.', ephemeral: true });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      const telefone = interaction.values[0];
      const menuUser = new UserSelectMenuBuilder().setCustomId(`transferir_user_${telefone}`).setPlaceholder('Escolha o novo telefonista');
      return interaction.update({ components: [new ActionRowBuilder().addComponents(menuUser)] });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
      const telefone = interaction.customId.replace('transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = estadoTelefones[telefone];
      await registrarEvento(telefone, `🔁 ${hora()} — ${antigo.nome} transferiu para ${novoUser.username} (${tempo(antigo.entrada)})`);
      estadoTelefones[telefone] = { userId: novoId, nome: novoUser.username, entrada: new Date() };
      atendimentosAtivos.set(antigo.userId, atendimentosAtivos.get(antigo.userId).filter(t => t !== telefone));
      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(telefone);
      await atualizarPainel();
      return interaction.update({ content: `✅ Telefone **${telefone}** transferido para **${novoUser.username}**.`, components: [] });
    }

    /* ===== FORÇAR DESCONEXÃO (ADMIN) ===== */
    if (interaction.isButton() && interaction.customId === 'forcar_desconectar') {
      const ocupados = Object.keys(estadoTelefones);
      if (ocupados.length === 0) return interaction.reply({ content: '⚠️ Nenhum telefone ocupado.', ephemeral: true });
      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(ocupados.map(t => ({ label: `Telefone ${t}`, description: `Em uso por ${estadoTelefones[t].nome}`, value: t })));
      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {
      const telefone = interaction.values[0];
      const dados = estadoTelefones[telefone];
      await registrarEvento(telefone, `🛑 ${hora()} — ${dados.nome} foi desconectado manualmente por ${interaction.user.username} (${tempo(dados.entrada)})`);
      delete estadoTelefones[telefone];
      if (atendimentosAtivos.has(dados.userId)) {
        atendimentosAtivos.set(dados.userId, atendimentosAtivos.get(dados.userId).filter(t => t !== telefone));
      }
      await atualizarPainel();
      return interaction.update({ content: `✅ Telefone **${telefone}** desconectado à força.`, components: [] });
    }

  } catch(err) {
    console.error('💥 Erro na interação:', err);
  }
});

/* ================= ERROS GLOBAIS ================= */
client.on('error', console.error);
client.on('warn', console.warn);

/* ================= EXPRESS KEEP ALIVE ================= */
app.get('/', (req, res) => res.send('Bot Online'));
app.listen(PORT, () => console.log(`🌐 Servidor Web rodando na porta ${PORT}`));

client.login(TOKEN);
