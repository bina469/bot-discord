require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

/* ================== CONFIG ================== */
const CHANNEL_ID = process.env.CHANNEL_ID;
const TELEFONES = ['João', 'Alina'];

/* ================== ESTADO ================== */
let painelMessage = null;
const estadoTelefones = {};
const atendimentosAtivos = new Map();

/* ================== PAINEL ================== */
async function atualizarPainel() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const linhas = TELEFONES.map(t => {
    const ativo = estadoTelefones[t];
    return ativo
      ? `🟢 **${t}** — ${ativo.nome}`
      : `🔴 **${t}** — Livre`;
  });

  const row1 = new ActionRowBuilder().addComponents(
    TELEFONES.map(t =>
      new ButtonBuilder()
        .setCustomId(`entrar_${t}`)
        .setLabel(`Entrar ${t}`)
        .setStyle(ButtonStyle.Success)
    )
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sair_um')
      .setLabel('Desconectar um')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('sair_todos')
      .setLabel('Desconectar todos')
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId('forcar_desconectar')
      .setLabel('Forçar desconexão')
      .setStyle(ButtonStyle.Danger)
  );

  if (!painelMessage) {
    painelMessage = await channel.send({
      content: `📞 **Painel de Telefones**\n\n${linhas.join('\n')}`,
      components: [row1, row2]
    });
  } else {
    await painelMessage.edit({
      content: `📞 **Painel de Telefones**\n\n${linhas.join('\n')}`,
      components: [row1, row2]
    });
  }
}

/* ================== READY ================== */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

/* ================== INTERAÇÕES ================== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const user = interaction.user;

  try {

    /* ===== ENTRAR ===== */
    if (interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[telefone]) {
        await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      estadoTelefones[telefone] = {
        userId: user.id,
        nome: user.username
      };

      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await atualizarPainel();

      await interaction.reply({ content: `📞 Conectado ao telefone ${telefone}`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];
      lista.forEach(t => delete estadoTelefones[t]);
      atendimentosAtivos.delete(user.id);

      await atualizarPainel();

      await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== SAIR UM ===== */
    if (interaction.customId === 'sair_um') {
      const lista = atendimentosAtivos.get(user.id) || [];

      if (!lista.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      const tel = lista.pop();
      delete estadoTelefones[tel];
      atendimentosAtivos.set(user.id, lista);

      await atualizarPainel();

      await interaction.reply({ content: `📴 Desconectado do telefone ${tel}`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== FORÇAR ===== */
    if (interaction.customId === 'forcar_desconectar') {
      Object.keys(estadoTelefones).forEach(t => delete estadoTelefones[t]);
      atendimentosAtivos.clear();

      await atualizarPainel();

      await interaction.reply({ content: '🛑 Desconexão forçada executada', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

  } catch (e) {
    console.error('Erro na interação:', e);
  }
});

/* ================== LOGIN ================== */
client.login(process.env.TOKEN);
