import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { fireworksProvider } from '@earendil-works/pi-ai/providers/fireworks';
import { setProvider } from '@flue/runtime';

// Fireworks serves only the pinned `deepseek-v4-flash-0731` snapshot on
// serverless (the rolling alias 404s), but the pinned catalog's pi version type-
// clashes with the one Flue bundles. So build on the type-matched catalog and
// clone its `deepseek-v4-flash` entry into the pinned id, which routes fine to
// Fireworks. Manual auth sidesteps a version-skew bug in the standalone
// envApiKeyAuth under Flue's runtime.
const PINNED_ID = 'accounts/fireworks/models/deepseek-v4-flash-0731';
const baseModels = fireworksProvider().getModels();
const flash = baseModels.find(
	(model) => model.id === 'accounts/fireworks/models/deepseek-v4-flash',
);
if (!flash) throw new Error('Fireworks catalog no longer declares deepseek-v4-flash to clone.');

setProvider(
	createProvider({
		id: 'fireworks',
		name: 'Fireworks',
		baseUrl: 'https://api.fireworks.ai/inference',
		auth: {
			apiKey: {
				name: 'Fireworks API key',
				resolve: async () => ({ auth: { apiKey: process.env.FIREWORKS_API_KEY } }),
			},
		},
		models: [...baseModels, { ...flash, id: PINNED_ID, name: 'DeepSeek V4 Flash 0731' }],
		api: {
			'anthropic-messages': anthropicMessagesApi(),
			'openai-completions': openAICompletionsApi(),
		},
	}),
);
