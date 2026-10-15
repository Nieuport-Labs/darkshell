<script lang="ts">
	import { t } from '../../lib/i18n/index.svelte';
	import { close } from '../../lib/ui.svelte';
	import Modal from '../ui/Modal.svelte';
	import ContactList from './ContactList.svelte';
</script>

<Modal full title={t('Address book')} onclose={close}>
	<p class="-mt-2 text-base text-text-muted">{t('Shared by all your accounts and stored encrypted with your recovery phrase, on this device only.')}</p>
	<ContactList />
</Modal>
