const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const express = require('express');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

const TELEFONES = ['Samantha', 'Katherine', 'Rosalia', 'Ingrid'];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const presenca = new Map();
let msgPainel = null;
let msgRelatorio = null;

// Atualiza relatório
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_PRESENCA_ID);
  let conteudo = '📊 **Relatório de Presença**\n';
  TELEFONES.forEach(t => {
    const user = presenca.get(t);
    conteudo += `• ${t}: ${user ? `🟥 ${user}` : '🟩 Livre'}\n`;
  });

  if (msgRelatorio) {
    await msgRelatorio.edit({ content: conteudo }).catch(async () => {
      msgRelatorio = await canal.send(conteudo);
    });
  } else {
    msgRelatorio = await canal.send(conteudo);
  }
}

// Atualiza painel principal
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);
  if (!msgPainel) {
    msgPainel = await canal.send({ content: '📞 **Painel de Presença**' });
  }

  const componentes = [
    new ActionRowBuilder().addComponents(
      TELEFONES.map(t =>
        new ButtonBuilder()
          .setCustomId(`conectar_${t}`)
          .setLabel(`${presenca.get(t) ? '🟥' : '🟩'} ${t}`)
          .setStyle(ButtonStyle.Primary)
      )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('desconectar_todos').setLabel('🔴 Desconectar todos').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('desconectar_um').setLabel('➖ Desconectar um').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('transferir').setLabel('🔁 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('forcar_desconexao').setLabel('⚠️ Forçar desconexão').setStyle(ButtonStyle.Danger)
    )
  ];

  await msgPainel.edit({ content: '📞 **Painel de Presença**', components: componentes });
}

client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  atualizarPainel();
  atualizarRelatorio();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const id = interaction.customId;

  if (id.startsWith('conectar_')) {
    const telefone = id.split('_')[1];
    presenca.set(telefone, interaction.user.id);
    await interaction.deferUpdate();
    atualizarPainel();
    atualizarRelatorio();
    return;
  }

  if (id === 'desconectar_todos') {
    presenca.clear();
    await interaction.deferUpdate();
    atualizarPainel();
    atualizarRelatorio();
    return;
  }

  if (id === 'desconectar_um' || id === 'transferir' || id === 'forcar_desconexao') {
    const opcoes = [];
    presenca.forEach((user, tel) => opcoes.push({ label: tel, value: tel }));
    if (opcoes.length === 0) return;

    // Aqui você pode implementar menus de seleção como antes, se quiser
    // Por enquanto apenas atualiza painel de status
    await interaction.deferUpdate();
  }
});

client.login(TOKEN);

const app = express();
app.get('/', (_, res) => res.send('Bot online'));
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
