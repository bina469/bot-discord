const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');
const express = require('express');
require('dotenv').config();

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT; // render usa esta porta obrigatoriamente

// CANAIS
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// TELEFONES
const TELEFONES = ['Samantha', 'Katherine', 'Rosalia', 'Ingrid'];

/* ================= BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= ESTADO ================= */
const presenca = new Map(); // telefone -> userId
let msgRelatorio = null; // mensagem do relatório

/* ================= FUNÇÕES ================= */
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_PRESENCA_ID);
  let conteudo = '📊 **Relatório de Presença**\n';
  TELEFONES.forEach(t => {
    const user = presenca.get(t);
    conteudo += `• ${t}: ${user ? `<@${user}>` : 'Desconectado'}\n`;
  });

  if (msgRelatorio) {
    await msgRelatorio.edit({ content: conteudo }).catch(async () => {
      msgRelatorio = await canal.send(conteudo);
    });
  } else {
    msgRelatorio = await canal.send(conteudo);
  }
}

async function enviarNotif(interaction, conteudo) {
  const msg = await interaction.followUp({ content: conteudo, ephemeral: true });
  setTimeout(() => msg.delete().catch(() => {}), 5000);
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);
  if (!canal) return;

  await canal.bulkDelete(5).catch(() => {});

  // Monta painel
  await canal.send({
    content: '📞 **Painel de Presença**',
    components: [
      new ActionRowBuilder().addComponents(
        TELEFONES.map(t => 
          new ButtonBuilder().setCustomId(`conectar_${t}`).setLabel(`📞 ${t}`).setStyle(ButtonStyle.Primary)
        )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('desconectar_todos').setLabel('🔴 Desconectar todos').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('desconectar_um').setLabel('➖ Desconectar um').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('transferir').setLabel('🔁 Transferir').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('forcar_desconexao').setLabel('⚠️ Forçar desconexão').setStyle(ButtonStyle.Danger)
      )
    ]
  });

  atualizarRelatorio();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  try {
    const id = interaction.customId;

    // ===== CONECTAR TELEFONE =====
    if (id.startsWith('conectar_')) {
      const telefone = id.split('_')[1];
      presenca.set(telefone, interaction.user.id);
      await enviarNotif(interaction, `📞 Conectado ao telefone **${telefone}**`);
      atualizarRelatorio();
      return;
    }

    // ===== DESCONECTAR TODOS =====
    if (id === 'desconectar_todos') {
      presenca.clear();
      await enviarNotif(interaction, '📴 Desconectado de todos os telefones');
      atualizarRelatorio();
      return;
    }

    // ===== DESCONECTAR UM =====
    if (id === 'desconectar_um') {
      const opcoes = [];
      presenca.forEach((user, tel) => opcoes.push({ label: tel, value: tel }));
      if (opcoes.length === 0) return enviarNotif(interaction, '❌ Nenhum telefone conectado');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('menu_desconectar_um')
        .setPlaceholder('Escolha o telefone')
        .addOptions(opcoes);

      await interaction.reply({ content: 'Selecione o telefone para desconectar:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return;
    }

    if (id === 'transferir') {
      const opcoes = [];
      presenca.forEach((user, tel) => opcoes.push({ label: tel, value: tel }));
      if (opcoes.length === 0) return enviarNotif(interaction, '❌ Nenhum telefone conectado');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('menu_transferir_telefone')
        .setPlaceholder('Escolha o telefone para transferir')
        .addOptions(opcoes);

      await interaction.reply({ content: 'Selecione o telefone para transferir:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return;
    }

    if (id === 'forcar_desconexao') {
      const opcoes = [];
      presenca.forEach((user, tel) => opcoes.push({ label: tel, value: tel }));
      if (opcoes.length === 0) return enviarNotif(interaction, '❌ Nenhum telefone conectado');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('menu_forcar_desconexao')
        .setPlaceholder('Escolha o telefone para forçar desconexão')
        .addOptions(opcoes);

      await interaction.reply({ content: 'Selecione o telefone para forçar desconexão:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return;
    }

    // ===== MENUS =====
    if (interaction.isStringSelectMenu()) {
      const telSelecionado = interaction.values[0];

      if (interaction.customId === 'menu_desconectar_um') {
        presenca.delete(telSelecionado);
        await enviarNotif(interaction, `✅ Telefone **${telSelecionado}** desconectado`);
        atualizarRelatorio();
        return;
      }

      if (interaction.customId === 'menu_forcar_desconexao') {
        presenca.delete(telSelecionado);
        await enviarNotif(interaction, `⚠️ Telefone **${telSelecionado}** desconectado FORÇADO`);
        atualizarRelatorio();
        return;
      }

      if (interaction.customId === 'menu_transferir_telefone') {
        await enviarNotif(interaction, `🔁 Telefone **${telSelecionado}** pronto para transferir (implemente lógica de escolha do novo usuário)`);
        return;
      }
    }

  } catch (err) {
    console.error('ERRO PAINEL:', err);
    interaction.followUp({ content: '⚠️ Ocorreu um erro ao processar a ação.', ephemeral: true }).catch(() => {});
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

