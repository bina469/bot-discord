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
const TOKEN = process.env.TOKEN;
const CARGO_TELEFONISTA = '.';

/* ================= TELEFONES ================= */
const telefones = [
  'Pathy','Samantha','Rosalia','Rafaela',
  'Sophia','Ingrid','Valentina','Melissa','Alina'
];

/* ================= ESTADO ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const transferenciasPendentes = new Map();
let mensagemPainelId = null;

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(canalPainelId);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
      : `🟢 Telefone ${t} — Livre`
  ).join('\n');

  const botoesTel = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTel.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoesTel.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sair_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('forcar').setLabel('🛑 Forçar Desconexão').setStyle(ButtonStyle.Danger)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId);
    await msg.edit({ content: texto, components: rows });
  } else {
    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;
  }
}

/* ================= BOT ================= */
client.once('ready', async () => {
  console.log(`🚀 Logado como ${client.user.tag}`);
  await atualizarPainel();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  try {

    /* ===== ENTRAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[telefone]) {
        await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      estadoTelefones[telefone] = { userId: user.id, nome: user.username };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await atualizarPainel();
      await interaction.reply({ content: `📞 Conectado ao telefone ${telefone}`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(user.id);

      await atualizarPainel();
      await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== SAIR UM ===== */
    if (interaction.isButton() && interaction.customId === 'sair_um') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um_menu')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      await interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um_menu') {
      const tel = interaction.values[0];
      delete estadoTelefones[tel];

      atendimentosAtivos.set(
        user.id,
        (atendimentosAtivos.get(user.id) || []).filter(t => t !== tel)
      );

      await atualizarPainel();
      await interaction.deferUpdate();
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== TRANSFERIR ===== */
    if (interaction.isButton() && interaction.customId === 'transferir') {
      const ocupados = Object.keys(estadoTelefones);
      if (!ocupados.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(ocupados.map(t => ({ label: t, value: t })));

      await interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      transferenciasPendentes.set(user.id, interaction.values[0]);

      const membros = interaction.guild.members.cache
        .filter(m => m.roles.cache.some(r => r.name === CARGO_TELEFONISTA))
        .map(m => ({ label: m.user.username, value: m.id }));

      if (!membros.length) {
        await interaction.update({ content: '⚠️ Nenhum telefonista disponível.', components: [] });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_user')
        .setPlaceholder('Escolha o telefonista')
        .addOptions(membros);

      await interaction.update({
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_user') {
      const tel = transferenciasPendentes.get(user.id);
      const novoUser = await client.users.fetch(interaction.values[0]);

      estadoTelefones[tel] = { userId: novoUser.id, nome: novoUser.username };
      transferenciasPendentes.delete(user.id);

      await atualizarPainel();
      await interaction.deferUpdate();
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== FORÇAR ===== */
    if (interaction.isButton() && interaction.customId === 'forcar') {
      const ocupados = Object.keys(estadoTelefones);
      if (!ocupados.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_menu')
        .setPlaceholder('Escolha o telefone')
        .addOptions(ocupados.map(t => ({ label: t, value: t })));

      await interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_menu') {
      delete estadoTelefones[interaction.values[0]];

      await atualizarPainel();
      await interaction.deferUpdate();
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

  } catch (e) {
    console.error('💥 Erro na interação:', e);
  }
});

client.login(TOKEN);

/* ================= EXPRESS ================= */
const app = express();
app.get('/', (_, res) => res.send('Online'));
app.listen(process.env.PORT || 3000);
