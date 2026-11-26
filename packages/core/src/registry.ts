import { MODULE_API_VERSION, SLOTS, type ModuleDefinition, type Slot } from './module-api';

/** Holds the modules available to an app or CLI session. */
export class ModuleRegistry {
  private modules = new Map<string, ModuleDefinition>();

  constructor(modules: ModuleDefinition[] = []) {
    for (const module of modules) this.register(module);
  }

  register(module: ModuleDefinition): void {
    if (!module || typeof module !== 'object' || typeof module.generate !== 'function') {
      throw new Error('Not a BEAUtique module: expected an object with a generate() function');
    }
    if (module.apiVersion !== MODULE_API_VERSION) {
      throw new Error(
        `Module "${module.id}" targets module API ${module.apiVersion}; this version of BEAUtique supports API ${MODULE_API_VERSION}`,
      );
    }
    if (!SLOTS.includes(module.slot)) {
      throw new Error(`Module "${module.id}" has unknown slot "${module.slot}"`);
    }
    if (this.modules.has(module.id)) {
      throw new Error(`A module with id "${module.id}" is already registered`);
    }
    this.modules.set(module.id, module);
  }

  get(id: string): ModuleDefinition | undefined {
    return this.modules.get(id);
  }

  bySlot(slot: Slot): ModuleDefinition[] {
    return this.all().filter((m) => m.slot === slot);
  }

  all(): ModuleDefinition[] {
    return [...this.modules.values()];
  }
}
