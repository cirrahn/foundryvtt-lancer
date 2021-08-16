// @ts-nocheck
// We do not care about this file being super rigorous
import { LANCER } from "./config";
import { handleActorExport } from "./helpers/io";
import { LancerActor, LancerDeployableData, LancerNpcData } from "./actor/lancer-actor";
import { core_update, LCPIndex, LCPManager, updateCore } from "./apps/lcpManager";
import { EntryType, NpcClass, NpcFeature, NpcTemplate, RegTagInstanceData } from "machine-mind";
import { LancerItem } from "./item/lancer-item";
import { RegRef } from "machine-mind/dist/registry";
import { arrayify_object } from "./helpers/commons";
import { LancerTokenDocument } from "./token";

let lp = LANCER.log_prefix;

/**
 * Perform a system migration for the entire World, applying migrations for Actors, Items, and Compendium packs
 * @return {Promise}      A Promise which resolves once the migration is completed
 */
export const migrateWorld = async function (migrateComps = true) {
  ui.notifications.info(
    `Applying LANCER System Migration for version ${game.system.data.version}. Please be patient and do not close your game or shut down your server.`,
    { permanent: true }
  );

  // Migrate World Compendium Packs
  if (migrateComps) {
    await scorchedEarthCompendiums();
    await updateCore(core_update);

    if ((await game.settings.get(LANCER.sys_name, LANCER.setting_core_data)) === core_update) {
      // Open the LCP manager for convenience.
      new LCPManager().render(true);

      // Compendium migration succeeded, prompt to migrate actors.
      new Dialog({
        title: `Migrate Pilots`,
        content: `
<p>Lancer compendiums have been successfully migrated to core version ${core_update}.</p>
<p>Next, you need to import all of the LCPs that your pilots require. You must use current, up-to-date
LCP compatible with Comp/Con.</p>
<p>Once that is complete, click the button below to start migrating all of your pilots. If you want 
to close this window while working on your LCPs, you can start migrating your pilots by clicking 
the button in the Compendium tab.</p>`,
        buttons: {
          accept: {
            label: "Start Migration",
            callback: async () => {
              await migrateActors(true, false);
            },
          },
          cancel: {
            label: "Close",
          },
        },
        default: "cancel",
      }).render(true);
    } else {
      // Compendium migration failed.
      new Dialog({
        title: `Compendium Migration Failed`,
        content: `
<p>Something went wrong while attempting to build the core data Compendiums for the new Lancer system.
Please refresh the page to try again.</p>`,
        buttons: {
          accept: {
            label: "Refresh",
            callback: async () => {
              ui.notifications.info("Page reloading in 3...");
              await sleep(1000);
              ui.notifications.info("2...");
              await sleep(1000);
              ui.notifications.info("1...");
              await sleep(1000);
              window.location.reload(false);
            },
          },
          cancel: {
            label: "Close",
          },
        },
        default: "accept",
      }).render(true);
    }

    // for (let p of game.packs) {
    //   if (p.metadata.package === "world" && ["Actor", "Item", "Scene"].includes(p.metadata.entity)) {
    //     await migrateCompendium(p);
    //   }
    // }
  }

  // Migrate World Actors
  // Only NPCs, not pilots or mechs. GMs gotta update LCPs first.
  for (let a of game.actors.contents) {
    try {
      const updateData = await migrateActorData(a);
      if (!isObjectEmpty(updateData)) {
        console.log(`Migrating Actor entity ${a.name}`);
        await a.update(updateData);
      }
    } catch (err) {
      console.log(err);
    }
  }

  // Migrate World Items
  for (let i of game.items.contents) {
    try {
      const updateData = await migrateItemData(i);
      if (!isObjectEmpty(updateData)) {
        console.log(`Migrating Item entity ${i.name}`);
        await i.update(updateData);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Migrate Actor Override Tokens
  for (let s of game.scenes.contents) {
    try {
      console.log(`Migrating Scene entity ${s.name}`);
      await migrateSceneData(s);
      // if (updateData && !isObjectEmpty(updateData)) {
        // await s.update(updateData);
      // }
    } catch (err) {
      console.error(err);
    }
  }

  // Set the migration as complete
  // await game.settings.set(LANCER.sys_name, LANCER.setting_migration, game.system.data.version);
  ui.notifications.info(`LANCER System Migration to version ${game.system.data.version} completed!`, {
    permanent: true,
  });
};

export const minor09Migration = async function (migrateComps = true) {
  //pass
}

/* -------------------------------------------- */

const compTitles = {
  old: [
    "Skill Triggers",
    "Talents",
    "Core Bonuses",
    "Pilot Armor",
    "Pilot Weapons",
    "Pilot Gear",
    "Frames",
    "Systems",
    "Weapons",
    "NPC Classes",
    "NPC Templates",
    "NPC Features",
  ],
  new: {
    Actor: ["Deployable"],
    Item: [
      "Core Bonus",
      "Environment",
      "Frame",
      "License",
      "Manufacturer",
      "Mech System",
      "Mech Weapon",
      "Pilot Armor",
      "Pilot Gear",
      "Reserve",
      "Sitrep",
      "Skill",
      "Status/Condition",
      "Tag",
      "Talent",
      "Weapon Mod",
    ],
  },
};

/**
 * Function to migrate old pilots to pilot/mech paradigm.
 * Gathers LIDs of all old pilot items, clears items, then performs a
 * mock-CC import with all of the found LIDs.
 * @param pilots
 */
export const migrateActors = async () => {
  let count = 0;
  for (let a of game.actors.values()) {
    try {
      if (a.data.type === EntryType.PILOT) {
        const ret = handleActorExport(a, false);
        if (ret) {
          console.log(`== Migrating Actor entity ${a.name}`);
          await (a as LancerActor).importCC(ret, true);
          console.log(ret);
          count++;
        }
      }
    } catch (err) {
      console.error(err);
      console.error(`== Migrating Actor entity ${a.name} failed.`);
    }
  }
  ui.notifications.info(`Migrations triggered: ${count}`);
};

export const scorchedEarthCompendiums = async () => {
  // Remove all packs.
  for (let comp of game.packs.filter(comp => compTitles.old.includes(comp.title))) {
    await comp.configure({ locked: false });
    await comp.deleteCompendium();
    console.debug(`Deleting ${comp.title}`);
  }
  // Build blank ones.
  for (let type in compTitles.new) {
    for (let title of compTitles.new[type]) {
      const id = title.toLocaleLowerCase().replace(" ", "_").split("/")[0];
      if (!game.packs.has(`world.${id}`)) {
        await CompendiumCollection.createCompendium({
          name: id,
          label: title,
          path: `packs/${id}.db`,
          private: false,
          entity: type,
          system: "lancer",
          package: "world",
        });
      }
    }
  }

  await game.settings.set(LANCER.sys_name, LANCER.setting_core_data, "0.0.0");
  await game.settings.set(LANCER.sys_name, LANCER.setting_lcps, new LCPIndex(null));
};

/**
 * Apply migration rules to all Entities within a single Compendium pack
 * @param pack
 * @return {Promise}
 */
export const migrateCompendium = async function (pack: Compendium) {
  const wasLocked = pack.locked;
  await pack.configure({ locked: false });
  if (pack.locked) return ui.notifications.error(`Could not migrate ${pack.collection} as it is locked.`);
  const entity = pack.metadata.entity;
  if (!["Actor", "Item", "Scene"].includes(entity)) return;

  // Begin by requesting server-side data model migration and get the migrated content
  try {
    await pack.migrate({});
  } catch (err) {
    console.error(err);
  }

  const content = await pack.getDocuments();

  // Iterate over compendium entries - applying fine-tuned migration functions
  for (let ent of content) {
    try {
      let updateData = null;
      if (entity === "Item") updateData = migrateItemData(ent as Item);
      else if (entity === "Actor") updateData = migrateActorData(ent as Actor);
      else if (entity === "Scene") updateData = migrateSceneData(ent.data);
      if (!isObjectEmpty(updateData)) {
        expandObject(updateData);
        updateData["_id"] = ent._id;
        await pack.updateEntity(updateData);
        console.debug(`Migrated ${entity} entity ${ent.name} in Compendium ${pack.collection}`);
      }
    } catch (err) {
      console.error(err);
    }
  }
  await pack.configure({ locked: wasLocked });
  console.log(`Migrated all ${entity} entities from Compendium ${pack.collection}`);
};

/* -------------------------------------------- */
/*  Entity Type Migration Helpers               */
/* -------------------------------------------- */

/**
 * Migrate a single Actor entity to incorporate latest data model changes
 * Return an Object of updateData to be applied
 * @param {Actor} actor   The actor to Update
 * @return {Object}       The updateData to apply
 */
export const migrateActorData = async function (actor: Actor) {
  let origData: any = actor.data;
  const updateData: LancerNpcData = { _id: origData._id, data: {} };

  // Insert code to migrate actor data model here
  // For migration from 0.1.20 to 1.0, only do NPCs and Deployables. Mechs didn't exist,
  // and pilots need the GM to import LCPs first.
  if (actor.data.type === EntryType.NPC) {
    updateData.data.tier = origData.data.tier_num;
    updateData.data.heat = origData.data.mech.heat.value;
    updateData.data.hp = origData.data.mech.hp.value;
    updateData.data.stress = origData.data.mech.stress.value;
    updateData.data.structure = origData.data.mech.structure.value;

    updateData["data.-=mech"] = null;
    updateData["data.-=npc_size"] = null;
    updateData["data.-=activations"] = null;
  } else if (actor.data.type === EntryType.DEPLOYABLE) {
    updateData.data.detail = origData.data.effect;
    updateData.data.heat = origData.data.heat.value;
    updateData.data.heatcap = origData.data.heat.max;
    updateData.data.hp = origData.data.hp.value;
    updateData.data.max_hp = origData.data.hp.max;

    updateData["data.-=description"] = null;
  } else {
    return {};
  }

  // Migrate Owned Items
  if (!actor.items) return updateData;
  let hasItemUpdates = false;
  const items = [];
  actor.items.forEach(i => {
    // Migrate the Owned Item
    let itemUpdate = migrateItemData(i);
    // Add it to the array of items to update
    if (!isObjectEmpty(itemUpdate)) {
      hasItemUpdates = true;
      i.push(itemUpdate);
    }
  });
  if (hasItemUpdates) {
    await actor.updateEmbeddedDocuments("Item", items, { parent: actor });
  }

  // Remove deprecated fields
  _migrateRemoveDeprecated(actor, updateData);

  return updateData;
};

/* -------------------------------------------- */

/**
 * Scrub an Actor's system data, removing all keys which are not explicitly defined in the system template
 * @param {ActorData} actorData    The data object for an Actor
 * @return {ActorData}             The scrubbed Actor data
 */
function cleanActorData(actorData: ActorData) {
  // Scrub system data
  const model = game.system.model.Actor[actorData.type];
  actorData.data = filterObject(actorData.data, model);

  // Scrub system flags
  const allowedFlags = CONFIG.LANCER.allowedActorFlags.reduce((obj, f) => {
    obj[f] = null;
    return obj;
  }, {});
  if (actorData.flags.lancer) {
    actorData.flags.lancer = filterObject(actorData.flags.lancer, allowedFlags);
  }

  // Return the scrubbed data
  return actorData;
}

/* -------------------------------------------- */

/**
 * Migrate a single Item entity to incorporate latest data model changes
 * @param item
 */
export const migrateItemData = async function (item: LancerItem<NpcClass | NpcTemplate | NpcFeature>) {
  const origData = item.data;
  const updateData = { _id: origData._id, data: {} };

  function ids_to_rr(id_arr: string[]): RegRef<EntryType.NPC_FEATURE>[] {
    return id_arr.map(feat_id => ({
      id: "",
      fallback_lid: feat_id,
      type: EntryType.NPC_FEATURE,
      reg_name: "comp_core",
    }));
  }

  switch (origData.type) {
    case EntryType.NPC_CLASS:
      console.log(`${lp} Migrating NPC class`, origData);
      // id -> lid
      updateData.data.lid = origData.data.id;
      // base_features convert from array of CC IDs to array of RegRefs.
      updateData.data.base_features = ids_to_rr(origData.data.base_features);
      // optional_features convert from array of CC IDs to array of RegRefs.
      updateData.data.optional_features = ids_to_rr(origData.data.optional_features);
      // stats -> base_stats
      //      evasion -> evade
      //      sensor_range -> sensor
      //      delete stress, structure
      updateData.data.base_stats = origData.data.stats;
      updateData.data.base_stats.evade = origData.data.stats.evasion;
      updateData.data.base_stats.sensor = origData.data.stats.sensor_range;
      updateData["data.base_stats.-=evasion"] = null;
      updateData["data.base_stats.-=sensor_range"] = null;
      updateData["data.base_stats.-=structure"] = null;
      updateData["data.base_stats.-=stress"] = null;
      // mech_type -> role
      updateData.data.role = origData.data.mech_type;
      // add power, type
      updateData.data.power = 100;
      // delete id, flavor_name, flavor_description, description, mech_type, item_type, note
      updateData["data.-=id"] = null;
      updateData["data.-=flavor_name"] = null;
      updateData["data.-=flavor_description"] = null;
      updateData["data.-=description"] = null;
      updateData["data.-=mech_type"] = null;
      updateData["data.-=item_type"] = null;
      updateData["data.-=note"] = null;

      break;
    case EntryType.NPC_TEMPLATE:
      console.log(`${lp} Migrating NPC template`, origData);
      // id -> lid
      updateData.data.lid = origData.data.id;
      // base_features convert from array of CC IDs to array of RegRefs.
      updateData.data.base_features = ids_to_rr(origData.data.base_features);
      // optional_features convert from array of CC IDs to array of RegRefs.
      updateData.data.optional_features = ids_to_rr(origData.data.optional_features);
      // add power
      updateData.data.power = 20;

      // delete flavor_name, flavor_description, item_type, note
      updateData["data.-=flavor_name"] = null;
      updateData["data.-=flavor_description"] = null;
      updateData["data.-=item_type"] = null;
      updateData["data.-=note"] = null;
      break;
    case EntryType.NPC_FEATURE:
      console.log(`${lp} Migrating NPC feature`, origData);
      updateData.data.lid = origData.data.id ? origData.data.id : "";
      updateData.data.loaded = true;
      updateData.data.type = origData.data.feature_type;
      updateData.data.origin = {
        name: origData.data.origin_name,
        base: origData.data.origin_base,
        type: origData.data.origin_type,
      };
      updateData.data.tier_override = 0;
      // Make sure accuracy and attack bonus are not strings
      updateData.data.accuracy = [];
      for (let acc of origData.data.accuracy) {
        if (typeof acc === "string") {
          if (acc === "") updateData.data.accuracy.push(0);
          else updateData.data.accuracy.push(parseInt(acc));
        } else updateData.data.accuracy.push(acc);
      }
      updateData.data.attack_bonus = [];
      for (let atk of origData.data.attack_bonus) {
        if (typeof atk === "string") {
          if (atk === "") updateData.data.attack_bonus.push(0);
          else updateData.data.attack_bonus.push(parseInt(atk));
        } else updateData.data.attack_bonus.push(atk);
      }
      // Transform damage. Old format is array of damage types, each type has an Array[3] of vals.
      // New format is an Array[3] of damage types per tier. Each damage type follows normal {type, val} spec.
      updateData.data.damage = [[], [], []];
      origData.data.damage.forEach((oldDamage: { type: str; val: [str | int] }) => {
        if (oldDamage.val && Array.isArray(oldDamage.val)) {
          for (let i = 0; i < Math.min(3, oldDamage.val.length); i++) {
            updateData.data.damage[i].push({ type: oldDamage.type, val: oldDamage.val[i] });
          }
        }
      });
      // Migrate & relink tags;
      updateData.data.tags = [];
      if (origData.data.tags) {
        let origTags = origData.data.tags;
        if (!Array.isArray(origTags)) {
          origTags = arrayify_object(origTags);
        }
        origTags.forEach(tag => {
          // If the tag doesn't have an id, skip it.
          // This could be made smarter to search the tag compendium tags by name - has to account for {VAL}.
          if (!tag.id) return;
          let newTagRef: RegRef<EntryType.TAG> = {
            id: "",
            fallback_lid: tag.id,
            reg_name: "comp_core",
            type: EntryType.TAG,
          };
          let newTag: RegTagInstanceData = {
            tag: newTagRef,
            val: tag.val,
          };
          updateData.data.tags.push(newTag);
        });
      }

      // Remove deprecated fields
      updateData["data.-=id"] = null;
      updateData["data.-=feature_type"] = null;
      updateData["data.-=max_uses"] = null;
      // Keep these ones if they have anything in them, just in case.
      if (origData.data.flavor_description === "") {
        updateData["data.-=flavor_description"] = null;
      }
      if (origData.data.flavor_name === "") {
        updateData["data.-=flavor_name"] = null;
      }
      if (origData.data.note === "") {
        updateData["data.-=note"] = null;
      }
      updateData["data.-=origin_name"] = null;
      updateData["data.-=origin_base"] = null;
      updateData["data.-=origin_type"] = null;

      break;
    default:
      return {};
  }

  // Remove deprecated fields
  _migrateRemoveDeprecated(item, updateData);

  // Return the migrated update data
  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Scene entity to incorporate changes to the data model of it's actor data overrides
 * Return an Object of updateData to be applied
 * @param {Object} scene  The Scene data to Update
 * @return {Object}       The updateData to apply
 */
export const migrateSceneData = async function (scene) {
  console.log(`Migrating scene ${scene.name}`);
  if (!scene.tokens) return;
  const tokens = [];
  scene.tokens.forEach(async (token: LancerTokenDocument) => {
    // Migrate unlinked actors
    if (!token.isLinked) {
      let token_actor = token.actor;
      let updateData = await migrateActorData(token_actor.data);
      if (updateData && !isObjectEmpty(updateData)) {
        await token_actor.update(updateData);
      }
    }

    // Migrate tokens themselves
    await migrateTokenData(token);
  });
}

// Migrates a TokenDocument (not the actor! just the token!)
export const migrateTokenData = async (token: LancerTokenDocument) => {
  let updateData = {};

  // Returns a corrected bar attribute or, if one could not be deduced, just hp
  const fix_bar_attribute = (attr_name: string) => {
    attr_name = attr_name || ""; // sanity
    if(attr_name.includes("heat")) {
      return "derived.heat";
    } else if (attr_name.includes("hp")) {
      return "derived.hp";
    } else if (attr_name.includes("shield")) {
      return "derived.overshield";
    } else if (attr_name.includes("burn")) {
      return "burn";
    } else if (attr_name.includes("struct")) {
      return "derived.structure";
    } else if (attr_name.includes("stress")) {
      return "derived.stress";
    } else if (attr_name.includes("rep")) {
      return "derived.repairs";
    } else {
      return "derived.hp"; // a safe alternative
    }
  };

  // Fix the standard bars individually
  if(token.data.bar1) {
    updateData["bar1"] = {
      attribute: fix_bar_attribute(token.data.bar1.attribute)
    };
  }
  if(token.data.bar2) {
    updateData["bar2"] = {
      attribute: fix_bar_attribute(token.data.bar2.attribute)
    };
  }

  // Fix bar brawlers
  if(token.data.flags?.barbrawl) {
    let bb_data = token.data.flags.barbrawl;
    let bb_update_data = {};
    for(let bar_key of Object.keys(bb_data.resourceBars)) {
      bb_update_data[bar_key] = {
        attribute: fix_bar_attribute(bb_update_data[bar_key].attribute)
      };
    }
    updateData["flags.barbrawl.resourceBars"] = bb_update_data;
  }

  // Apply update
  token.update(updateData);
};
  // return tokens.map(t => {
  //   if (!t.actorId || t.actorLink || !t.actorData.data) {
  //     t.actorData = {};
  //     return t;
  //   }
  //   const token = new Token(t);
  //   if (!token.actor) {
  //     t.actorId = null;
  //     t.actorData = {};
  //   } else if (!t.actorLink) {
  //     const updateData = migrateActorData(token.data.actorData);
  //     t.actorData = mergeObject(token.data.actorData, updateData);
  //   }
  //   return t;
  // });

  // If the scene data itself needs to be migrated, make the changes and return the migrated data here.

/* -------------------------------------------- */

/**
 * A general migration to remove all fields from the data model which are flagged with a _deprecated tag
 * @private
 */
const _migrateRemoveDeprecated = function (ent, updateData) {
  const flat = flattenObject(ent.data);

  // Identify objects to deprecate
  const toDeprecate = Object.entries(flat)
    .filter(e => e[0].endsWith("_deprecated") && e[1] === true)
    .map(e => {
      let parent = e[0].split(".");
      parent.pop();
      return parent.join(".");
    });

  // Remove them
  for (let k of toDeprecate) {
    let parts = k.split(".");
    parts[parts.length - 1] = "-=" + parts[parts.length - 1];
    updateData[`data.${parts.join(".")}`] = null;
  }
};
