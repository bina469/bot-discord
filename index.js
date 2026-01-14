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

      estadoTelefones[telefone] = {
        userId: user.id,
        nome: user.username,
        entrada: new Date()
      };

      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await atualizarPainel();

      await interaction.reply({ content: `📞 Conectado ao telefone ${telefone}`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== SAIR TODOS ===== */
    else if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(user.id);

      await atualizarPainel();

      await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== SAIR UM ===== */
    else if (interaction.isButton() && interaction.customId === 'sair_um') {
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

    else if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um_menu') {
      const tel = interaction.values[0];

      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        user.id,
        (atendimentosAtivos.get(user.id) || []).filter(t => t !== tel)
      );

      await atualizarPainel();
      await interaction.update({ components: [] });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== TRANSFERIR ===== */
    else if (interaction.isButton() && interaction.customId === 'transferir') {
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

    else if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      transferenciasPendentes.set(user.id, interaction.values[0]);

      const membros = interaction.guild.members.cache
        .filter(m => m.roles.cache.some(r => r.name === CARGO_TELEFONISTA))
        .map(m => ({ label: m.user.username, value: m.id }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_user')
        .setPlaceholder('Escolha o telefonista')
        .addOptions(membros);

      await interaction.update({
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    else if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_user') {
      const tel = transferenciasPendentes.get(user.id);
      const novoUser = await client.users.fetch(interaction.values[0]);

      estadoTelefones[tel] = {
        userId: novoUser.id,
        nome: novoUser.username,
        entrada: new Date()
      };

      transferenciasPendentes.delete(user.id);

      await atualizarPainel();
      await interaction.update({ components: [] });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

    /* ===== FORÇAR ===== */
    else if (interaction.isButton() && interaction.customId === 'forcar') {
      const ocupados = Object.keys(estadoTelefones);

      if (!ocupados.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_menu')
        .setPlaceholder('Forçar desconexão')
        .addOptions(ocupados.map(t => ({ label: t, value: t })));

      await interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
      return;
    }

    else if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_menu') {
      delete estadoTelefones[interaction.values[0]];

      await atualizarPainel();
      await interaction.update({ components: [] });
      setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
      return;
    }

  } catch (e) {
    console.error('Erro:', e);
  }
});
