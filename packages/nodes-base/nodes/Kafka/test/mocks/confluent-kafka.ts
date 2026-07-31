import { vi } from 'vitest';

let accessCount = 0;

/**
 * vi.mock factory for '@confluentinc/kafka-javascript'. `KafkaJS` is exposed via a
 * getter so the counter increments on every *read* of the property, not once per
 * module load — a factory-invocation counter would be satisfied by Vitest's own
 * module-registry caching and prove nothing about client.ts's own cache.
 *
 * accessCount resets only at process start. This file has one test case today; if a
 * future test file adds more lazy-load cases, reset it in that file's beforeEach.
 */
export function confluentKafkaModuleMock(): { readonly KafkaJS: unknown } {
	return {
		get KafkaJS() {
			accessCount += 1;
			return {
				Kafka: vi.fn().mockImplementation((config?: unknown) => ({
					config,
					connect: vi.fn(),
					disconnect: vi.fn(),
					producer: vi.fn(),
					consumer: vi.fn(),
					admin: vi.fn(),
				})),
				logLevel: { NOTHING: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 },
			};
		},
	};
}

export function getConfluentKafkaAccessCount(): number {
	return accessCount;
}

export function resetConfluentKafkaAccessCount(): void {
	accessCount = 0;
}
