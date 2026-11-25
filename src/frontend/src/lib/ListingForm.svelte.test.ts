/**
 * The listing form on its own: where the coordinates come from, and what it
 * refuses to send. The browser's position is a fake; nothing asks a real one.
 */

import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ListingForm from './ListingForm.svelte';
import type { ListingDraft } from './contract';
import { EMPTY_LISTING, type SubmitResult } from './listing';
import type { Located } from './near';

/** The form, with `located` as every position request's answer. */
function setup(located: Located) {
	const submitted: ListingDraft[] = [];
	let asked = 0;
	render(ListingForm, {
		onSubmit: async (draft: ListingDraft): Promise<SubmitResult> => {
			submitted.push(draft);
			return { kind: 'saved' };
		},
		onCancel: () => {},
		findLocation: async () => {
			asked += 1;
			return located;
		}
	});
	return { submitted, asked: () => asked };
}

const coordinates = () => page.getByRole('textbox', { name: 'Coordinates' });

async function fillRequired(): Promise<void> {
	await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Quiet Corner Cafe');
	await page.getByRole('combobox', { name: 'Borough' }).selectOptions('Manhattan');
}

describe('the coordinates', () => {
	it('fills in the current location, which the owner can still change', async () => {
		const { submitted, asked } = setup({ kind: 'found', latitude: 40.7259, longitude: -73.9946 });

		await page.getByRole('button', { name: 'Use my current location' }).click();

		await expect.element(coordinates()).toHaveValue('40.725900, -73.994600');
		expect(asked()).toBe(1);
		await expect.element(page.getByText('Check the location before saving.')).toBeVisible();

		await coordinates().fill('40.7262, -73.9950');
		await fillRequired();
		await page.getByRole('button', { name: 'Add listing' }).click();

		await expect.poll(() => submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({ latitude: 40.7262, longitude: -73.995 });
	});

	it.each([
		['denied', 'Location access is blocked. Paste the coordinates instead.'],
		['unavailable', 'Could not find your location. Try again, or paste the coordinates.'],
		['unsupported', 'This browser cannot share your location. Paste the coordinates instead.']
	] as const)(
		'says briefly when the location is %s, and pasting still works',
		async (kind, notice) => {
			const { submitted } = setup({ kind });

			await page.getByRole('button', { name: 'Use my current location' }).click();

			await expect.element(page.getByRole('status')).toHaveTextContent(notice);
			await expect.element(coordinates()).toHaveValue('');

			await coordinates().fill('40.72590, -73.99460');
			await fillRequired();
			await page.getByRole('button', { name: 'Add listing' }).click();

			await expect.poll(() => submitted).toHaveLength(1);
			expect(submitted[0]).toMatchObject({ latitude: 40.7259, longitude: -73.9946 });
		}
	);

	it('shows a current location outside the city, but will not send it', async () => {
		const { submitted } = setup({ kind: 'found', latitude: 51.5072, longitude: -0.1276 });

		await page.getByRole('button', { name: 'Use my current location' }).click();

		await expect.element(coordinates()).toHaveValue('51.507200, -0.127600');
		await expect
			.element(page.getByText('These coordinates are not in New York City.'))
			.toBeVisible();

		await fillRequired();
		await page.getByRole('button', { name: 'Add listing' }).click();

		await expect.element(coordinates()).toHaveAttribute('aria-invalid', 'true');
		expect(submitted).toEqual([]);
	});
});

describe('submitting', () => {
	it('says what is missing beside each control, and sends nothing', async () => {
		const { submitted } = setup({ kind: 'unsupported' });

		await page.getByRole('button', { name: 'Add listing' }).click();

		await expect.element(page.getByText('Enter the name of your space.')).toBeVisible();
		await expect.element(page.getByText('Choose a borough.')).toBeVisible();
		await expect
			.element(page.getByText('Enter the coordinates, or use your current location.'))
			.toBeVisible();
		expect(submitted).toEqual([]);
	});
});

describe('editing', () => {
	it('starts from the listing and says it saves changes', async () => {
		render(ListingForm, {
			purpose: 'edit',
			initial: {
				...EMPTY_LISTING,
				name: 'Quiet Corner Cafe',
				borough: 'Queens',
				coordinates: '40.746600, -73.700400',
				venue_wifi: 'yes'
			},
			onSubmit: async (): Promise<SubmitResult> => ({ kind: 'saved' }),
			onCancel: () => {}
		});

		await expect.element(page.getByRole('heading', { name: 'Edit listing' })).toBeVisible();
		await expect
			.element(page.getByRole('textbox', { name: 'Name', exact: true }))
			.toHaveValue('Quiet Corner Cafe');
		await expect.element(page.getByRole('combobox', { name: 'Borough' })).toHaveValue('Queens');
		await expect.element(coordinates()).toHaveValue('40.746600, -73.700400');
		await expect
			.element(page.getByRole('group', { name: 'Wi-Fi for visitors' }).getByLabelText('Yes'))
			.toBeChecked();
		await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
	});
});
