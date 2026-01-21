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
const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;

// Painel de presença
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// Telefones
const telefones = ['Samantha','Katherine','Rosalia','Ingrid'];

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= ESTADO ================= */
const presenca = new Map(); // telefone -> { userId, nome, entrada }
const atendimentosAtivos = new Map(); // userId -> [telefones]
const relatorioDiario = {}; // data -> telefone -> [eventos]
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

  try {
    const canal = await client.channels.fetch(CANAL_RELATORIO_PRESENCA_ID);
    let textoRelatorio = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;
    for (const tel of Object.keys(relatorioDiario[data])) {
      textoRelatorio += `📞 **Telefone ${tel}**\n`;
      textoRelatorio += relatorioDiario[data][tel].join('\n') + `\n----------------------\n`;
    }

    if (mensagemRelatorioId) {
      try {
        const msg = await canal.messages.fetch(mensagemRelatorioId);
        await msg.edit(textoRelatorio);
      } catch {
        const msg = await canal.send(textoRelatorio);
        mensagemRelatorioId = msg.id;
      }
    } else {
      const msg = await canal.send(textoRelatorio);
      mensagemRelatorioId = msg.id;
    }
  } catch (err) {
    console.log('⚠️ Falha ao atualizar relatório:', err.message);
  }
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  try {
    const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

    const status = telefones.map(t =>
      presenca.has(t)
        ? `🔴 Telefone ${t} — ${presenca.get(t).nome}`
        : `🟢 Telefone ${t} — Livre`
    ).join('\n');

    // Linha de botões de conexão
    const botoesConectar = telefones.map(t =>
      new ButtonBuilder()
        .setCustomId(`conectar_${t}`)
        .setLabel(`📞 ${t}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(presenca.has(t))
    );
    const rowConectar = new ActionRowBuilder().addComponents(botoesConectar);

    // Linha de botões de ações
    const rowAcoes = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('desconectar_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('desconectar_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('forcar_desconexao').setLabel('⚠️ Forçar desconexão').setStyle(ButtonStyle.Danger)
    );

    const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

    if (mensagemPainelId) {
      try {
        const msg = await canal.messages.fetch(mensagemPainelId);
        await msg.edit({ content: texto, components: [rowConectar, rowAcoes] });
      } catch {
        const msg = await canal.send({ content: texto, components: [rowConectar, rowAcoes] });
        mensagemPainelId = msg.id;
      }
    } else {
      const msg = await canal.send({ content: texto, components: [rowConectar, rowAcoes] });
      mensagemPainelId = msg.id;
    }
  } catch (err) {
    console.log('⚠️ Falha ao atualizar painel:', err.message);
  }
}

/* ================= BOT ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

client.on('interactionCreate', async interaction => {
  try {
    const user = interaction.user;

    if (interaction.isButton()) {
      await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });

      /* ===== CONECTAR TELEFONE ===== */
      if (interaction.customId.startsWith('conectar_')) {
        const tel = interaction.customId.replace('conectar_', '');
        if (presenca.has(tel)) return interaction.editReply(`⚠️ Telefone ${tel} já está ocupado.`);

        presenca.set(tel, { userId: user.id, nome: user.username, entrada: Date.now() });
        if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
        atendimentosAtivos.get(user.id).push(tel);

        await registrarEvento(tel, `🟢 ${hora()} — ${user.username} conectou`);
        await atualizarPainel();

        return interaction.editReply(`📞 Conectado ao telefone ${tel}`);
      }

      /* ===== DESCONECTAR TODOS ===== */
      if (interaction.customId === 'desconectar_todos') {
        const lista = atendimentosAtivos.get(user.id) || [];
        for (const tel of lista) {
          const dados = presenca.get(tel);
          await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} desconectou todos (${tempo(dados.entrada)})`);
          presenca.delete(tel);
        }
        atendimentosAtivos.delete(user.id);
        await atualizarPainel();
        return interaction.editReply('📴 Desconectado de todos os telefones');
      }

      /* ===== DESCONECTAR UM ===== */
      if (interaction.customId === 'desconectar_um') {
        const lista = atendimentosAtivos.get(user.id) || [];
        if (lista.length === 0) return interaction.editReply('⚠️ Você não está conectado em nenhum telefone.');

        const menu = new StringSelectMenuBuilder()
          .setCustomId('menu_sair_um')
          .setPlaceholder('Escolha o telefone para desconectar')
          .addOptions(lista.map(t => ({ label: t, value: t })));

        return interaction.editReply({ content: 'Selecione o telefone:', components: [new ActionRowBuilder().addComponents(menu)] });
      }

      /* ===== TRANSFERIR ===== */
      if (interaction.customId === 'transferir') {
        const lista = atendimentosAtivos.get(user.id) || [];
        if (lista.length === 0) return interaction.editReply('⚠️ Você não está conectado em nenhum telefone.');

        const menu = new StringSelectMenuBuilder()
          .setCustomId('menu_transferir_tel')
          .setPlaceholder('Escolha o telefone para transferir')
          .addOptions(lista.map(t => ({ label: t, value: t })));

        return interaction.editReply({ content: 'Selecione o telefone para transferir:', components: [new ActionRowBuilder().addComponents(menu)] });
      }

      /* ===== FORÇAR DESCONEXÃO ===== */
      if (interaction.customId === 'forcar_desconexao') {
        const conectados = Array.from(presenca.keys());
        if (conectados.length === 0) return interaction.editReply('⚠️ Nenhum telefone está conectado.');

        const menu = new StringSelectMenuBuilder()
          .setCustomId('menu_forcar')
          .setPlaceholder('Escolha o telefone para forçar desconexão')
          .addOptions(conectados.map(t => ({ label: t, value: t })));

        return interaction.editReply({ content: 'Selecione o telefone para forçar desconexão:', components: [new ActionRowBuilder().addComponents(menu)] });
      }
    }

    /* ===== STRING SELECT MENUS ===== */
    if (interaction.isStringSelectMenu()) {
      const userId = interaction.user.id;

      /* Desconectar um */
      if (interaction.customId === 'menu_sair_um') {
        const tel = interaction.values[0];
        const dados = presenca.get(tel);
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} desconectou (${tempo(dados.entrada)})`);
        presenca.delete(tel);
        atendimentosAtivos.set(userId, atendimentosAtivos.get(userId).filter(t => t !== tel));
        await atualizarPainel();
        return interaction.update({ content: `✅ Telefone ${tel} desconectado.`, components: [] });
      }

      /* Transferir telefone */
      if (interaction.customId === 'menu_transferir_tel') {
        const tel = interaction.values[0];
        const menuUser = new UserSelectMenuBuilder()
          .setCustomId(`menu_transferir_user_${tel}`)
          .setPlaceholder('Escolha o novo telefonista');
        return interaction.update({ components: [new ActionRowBuilder().addComponents(menuUser)] });
      }

      /* Forçar desconexão */
      if (interaction.customId === 'menu_forcar') {
        const tel = interaction.values[0];
        const dados = presenca.get(tel);
        await registrarEvento(tel, `⚠️ ${hora()} — ${dados.nome} desconectado à força`);
        presenca.delete(tel);
        atendimentosAtivos.set(dados.userId, atendimentosAtivos.get(dados.userId).filter(t => t !== tel));
        await atualizarPainel();
        return interaction.update({ content: `⚠️ Telefone ${tel} desconectado à força.`, components: [] });
      }
    }

    /* ===== USER SELECT MENUS ===== */
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('menu_transferir_user_')) {
      const tel = interaction.customId.replace('menu_transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = presenca.get(tel);

      await registrarEvento(tel, `🔁 ${hora()} — ${antigo.nome} transferiu para ${novoUser.username} (${tempo(antigo.entrada)})`);

      presenca.set(tel, { userId: novoId, nome: novoUser.username, entrada: Date.now() });

      atendimentosAtivos.set(antigo.userId, atendimentosAtivos.get(antigo.userId).filter(t => t !== tel));
      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(tel);

      await atualizarPainel();
      return interaction.update({ content: `✅ Telefone ${tel} transferido para ${novoUser.username}.`, components: [] });
    }

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

/* ================= COMANDOS GIT ================= */
console.log('💾 Para subir no Git, use:');
console.log('git add .');
console.log('git commit -m "🎉 Painel de presença funcional pronto"');
console.log('git push');
