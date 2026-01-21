const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const express = require('express');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';
const telefones = ['Samantha', 'Katherine', 'Rosalia', 'Ingrid'];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const presenca = {};
const atendimentosAtivos = {};
const relatorioDiario = {};
let mensagemPainelId = null;

function hoje() { return new Date().toLocaleDateString('pt-BR'); }
function hora() { return new Date().toLocaleTimeString('pt-BR'); }
function tempo(entrada) {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
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

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) await msg.edit(texto);
  } else {
    const msg = await canal.send(texto);
    mensagemPainelId = msg.id;
  }
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
}

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);
  const status = telefones.map(t => presenca[t] ? `🔴 ${t} — ${presenca[t].nome}` : `🟢 ${t} — Livre`).join('\n');

  const botoesTelefone = telefones.map(t => new ButtonBuilder()
    .setCustomId(`entrar_${t}`)
    .setLabel(`${t}`)
    .setStyle(presenca[t] ? ButtonStyle.Danger : ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTelefone.length; i += 4) rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 4)));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('forcar_desconexao').setLabel('⚠️ Forçar').setStyle(ButtonStyle.Danger)
  ));

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) await msg.edit({ content: texto, components: rows });
  } else {
    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;
  }
}

async function enviarMsgTemporaria(interaction, texto) {
  // Apenas um reply por interação
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: texto, ephemeral: true }).catch(() => {});
  } else {
    await interaction.editReply({ content: texto, ephemeral: true }).catch(() => {});
  }
}

client.once('clientReady', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (presenca[telefone]) return enviarMsgTemporaria(interaction, '⚠️ Telefone ocupado.');

      presenca[telefone] = { userId: user.id, nome: user.username, entrada: Date.now() };
      if (!atendimentosAtivos[user.id]) atendimentosAtivos[user.id] = [];
      atendimentosAtivos[user.id].push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();
      return enviarMsgTemporaria(interaction, `📞 Conectado ao telefone **${telefone}**`);
    }

    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos[user.id] || [];
      for (const tel of lista) {
        const dados = presenca[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete presenca[tel];
      }
      delete atendimentosAtivos[user.id];
      await atualizarPainel();
      return enviarMsgTemporaria(interaction, '📴 Desconectado de todos os telefones');
    }

    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos[user.id] || [];
      if (lista.length === 0) return enviarMsgTemporaria(interaction, '⚠️ Nenhum telefone conectado');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um_menu')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));
      return interaction.update({ components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um_menu') {
      const telefone = interaction.values[0];
      const dados = presenca[telefone];
      await registrarEvento(telefone, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
      delete presenca[telefone];
      atendimentosAtivos[dados.userId] = atendimentosAtivos[dados.userId].filter(t => t !== telefone);
      await atualizarPainel();
      return enviarMsgTemporaria(interaction, `✅ Telefone **${telefone}** desconectado.`);
    }

    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const lista = atendimentosAtivos[user.id] || [];
      if (lista.length === 0) return enviarMsgTemporaria(interaction, '⚠️ Nenhum telefone conectado');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel_menu')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));
      return interaction.update({ components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel_menu') {
      const telefone = interaction.values[0];
      const menuUser = new UserSelectMenuBuilder()
        .setCustomId(`transferir_user_${telefone}`)
        .setPlaceholder('Escolha o novo telefonista');
      return interaction.update({ components: [new ActionRowBuilder().addComponents(menuUser)] });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
      const telefone = interaction.customId.replace('transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = presenca[telefone];

      await registrarEvento(telefone, `🔁 ${hora()} — ${antigo.nome} transferiu para ${novoUser.username} (${tempo(antigo.entrada)})`);
      presenca[telefone] = { userId: novoId, nome: novoUser.username, entrada: antigo.entrada };
      atendimentosAtivos[antigo.userId] = atendimentosAtivos[antigo.userId].filter(t => t !== telefone);
      if (!atendimentosAtivos[novoId]) atendimentosAtivos[novoId] = [];
      atendimentosAtivos[novoId].push(telefone);

      await atualizarPainel();
      return enviarMsgTemporaria(interaction, `✅ Telefone **${telefone}** transferido para **${novoUser.username}**.`);
    }

    if (interaction.isButton() && interaction.customId === 'forcar_desconexao') {
      const conectados = Object.keys(presenca);
      if (conectados.length === 0) return enviarMsgTemporaria(interaction, '⚠️ Nenhum telefone conectado');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_desconexao_menu')
        .setPlaceholder('Escolha o telefone')
        .addOptions(conectados.map(t => ({ label: t, value: t })));
      return interaction.update({ components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_desconexao_menu') {
      const telefone = interaction.values[0];
      const dados = presenca[telefone];
      await registrarEvento(telefone, `⚠️ ${hora()} — ${dados.nome} desconectado FORÇADO (${tempo(dados.entrada)})`);
      delete presenca[telefone];
      atendimentosAtivos[dados.userId] = atendimentosAtivos[dados.userId].filter(t => t !== telefone);
      await atualizarPainel();
      return enviarMsgTemporaria(interaction, `⚠️ Telefone **${telefone}** desconectado FORÇADO.`);
    }

  } catch (err) {
    console.error('ERRO PAINEL:', err);
    if (interaction && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '⚠️ Ocorreu um erro.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(TOKEN);

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(process.env.PORT || 3000);
