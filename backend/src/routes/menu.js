const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { requireAuth, requireRole } = require('../middleware/auth');

const ALLOWED_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const VALID_STATIONS = ['kitchen', 'bar', 'none'];
const VALID_TAX_CATEGORIES = ['food', 'liquor', 'wine', 'beer', 'uncategorized'];

// uploadsDir is passed in from index.js, which already knows DB_PATH — images
// live on the same volume as the SQLite file so they survive restarts with
// no extra compose configuration.
function createMenuRouter(db, uploadsDir) {
  const router = express.Router();

  const menuDir = path.join(uploadsDir, 'menu');
  fs.mkdirSync(menuDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: menuDir,
      filename: (req, file, cb) => {
        const ext = ALLOWED_IMAGE_TYPES[file.mimetype];
        cb(null, `menuitem-${req.params.id}-${Date.now()}.${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      cb(null, Boolean(ALLOWED_IMAGE_TYPES[file.mimetype]));
    },
  });

  const listMenuItems = db.prepare(
    'SELECT id, name, category, category_id, retail_price, active, image_url, station FROM menu_items WHERE active = 1 ORDER BY category, name'
  );
  const getMenuItem = db.prepare(
    'SELECT id, name, category, category_id, retail_price, active, image_url, station FROM menu_items WHERE id = ?'
  );
  const insertMenuItem = db.prepare(
    'INSERT INTO menu_items (name, category, category_id, retail_price, active, station) VALUES (?, ?, ?, ?, 1, ?)'
  );
  const insertCategoryIfMissing = db.prepare(
    'INSERT INTO menu_categories (name, tax_category) VALUES (?, ?) ON CONFLICT(name) DO NOTHING'
  );
  const getCategoryByName = db.prepare('SELECT id FROM menu_categories WHERE name = ?');
  const listCategories = db.prepare('SELECT * FROM menu_categories WHERE active = 1 ORDER BY name');
  const getCategory = db.prepare('SELECT * FROM menu_categories WHERE id = ?');

  // The free-text `category` (display grouping, e.g. "Tacos") is the source
  // of truth; category_id is a derived lookup into menu_categories (the
  // tax-relevant grouping), auto-created the first time a name is seen —
  // same pattern as init.js's boot-time backfill. Renaming a category's
  // display text here effectively creates a new tax_category mapping
  // (defaulting to 'uncategorized') the first time; an admin reclassifies
  // it via PATCH /api/menu/categories/:id afterward.
  function resolveCategoryId(name) {
    insertCategoryIfMissing.run(name, 'uncategorized');
    return getCategoryByName.get(name).id;
  }
  const listOptionsFor = db.prepare('SELECT id, label FROM menu_item_options WHERE menu_item_id = ? ORDER BY sort_order');
  const listAllOptions = db.prepare('SELECT id, menu_item_id, label FROM menu_item_options ORDER BY menu_item_id, sort_order');
  const countOptionsFor = db.prepare('SELECT COUNT(*) AS n FROM menu_item_options WHERE menu_item_id = ?');
  const insertOption = db.prepare(
    'INSERT INTO menu_item_options (menu_item_id, label, sort_order) VALUES (?, ?, ?)'
  );
  const getOption = db.prepare('SELECT id FROM menu_item_options WHERE id = ? AND menu_item_id = ?');
  const deleteOption = db.prepare('DELETE FROM menu_item_options WHERE id = ?');

  // Recipe lines drive both the food-cost calculation on orders.js and
  // (once an admin has built them) stock deduction when an order is sent to
  // the kitchen.
  const listAllRecipeLines = db.prepare(`
    SELECT ri.menu_item_id, ri.ingredient_id, ri.quantity_required, i.name, i.unit
    FROM recipe_items ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    ORDER BY ri.menu_item_id, i.name
  `);
  const getIngredient = db.prepare('SELECT id FROM ingredients WHERE id = ? AND active = 1');
  const getRecipeLine = db.prepare('SELECT 1 FROM recipe_items WHERE menu_item_id = ? AND ingredient_id = ?');
  const insertRecipeLine = db.prepare(
    'INSERT INTO recipe_items (menu_item_id, ingredient_id, quantity_required) VALUES (?, ?, ?)'
  );
  const updateRecipeLine = db.prepare(
    'UPDATE recipe_items SET quantity_required = ? WHERE menu_item_id = ? AND ingredient_id = ?'
  );
  const deleteRecipeLine = db.prepare('DELETE FROM recipe_items WHERE menu_item_id = ? AND ingredient_id = ?');

  const listRecipeFor = db.prepare(`
    SELECT ri.ingredient_id, ri.quantity_required, i.name, i.unit
    FROM recipe_items ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.menu_item_id = ?
    ORDER BY i.name
  `);

  function withOptions(item) {
    return { ...item, options: listOptionsFor.all(item.id), recipe: listRecipeFor.all(item.id) };
  }

  // Any authenticated role can read the menu — Order Entry needs it.
  router.get('/', requireAuth, (_req, res) => {
    const items = listMenuItems.all();
    const optionsByItem = {};
    for (const opt of listAllOptions.all()) {
      (optionsByItem[opt.menu_item_id] ??= []).push({ id: opt.id, label: opt.label });
    }
    const recipeByItem = {};
    for (const line of listAllRecipeLines.all()) {
      (recipeByItem[line.menu_item_id] ??= []).push({
        ingredient_id: line.ingredient_id,
        name: line.name,
        unit: line.unit,
        quantity_required: line.quantity_required,
      });
    }
    res.json(
      items.map((item) => ({
        ...item,
        options: optionsByItem[item.id] ?? [],
        recipe: recipeByItem[item.id] ?? [],
      }))
    );
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { name, category, retail_price: retailPrice, station } = req.body ?? {};
    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (typeof category !== 'string' || category.trim() === '') {
      return res.status(400).json({ error: 'category is required' });
    }
    if (typeof retailPrice !== 'number' || !Number.isFinite(retailPrice) || retailPrice < 0) {
      return res.status(400).json({ error: 'retail_price must be a non-negative number' });
    }
    if (station !== undefined && !VALID_STATIONS.includes(station)) {
      return res.status(400).json({ error: `station must be one of: ${VALID_STATIONS.join(', ')}` });
    }

    const trimmedCategory = category.trim();
    const { lastInsertRowid } = insertMenuItem.run(
      name.trim(),
      trimmedCategory,
      resolveCategoryId(trimmedCategory),
      retailPrice,
      station ?? 'kitchen'
    );
    res.status(201).json(withOptions(getMenuItem.get(lastInsertRowid)));
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getMenuItem.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'menu item not found' });
    }

    const { name, category, retail_price: retailPrice, active, station } = req.body ?? {};
    if (station !== undefined && !VALID_STATIONS.includes(station)) {
      return res.status(400).json({ error: `station must be one of: ${VALID_STATIONS.join(', ')}` });
    }
    const next = {
      name: typeof name === 'string' && name.trim() !== '' ? name.trim() : existing.name,
      category: typeof category === 'string' && category.trim() !== '' ? category.trim() : existing.category,
      retail_price:
        typeof retailPrice === 'number' && Number.isFinite(retailPrice) && retailPrice >= 0
          ? retailPrice
          : existing.retail_price,
      active: active !== undefined ? (active ? 1 : 0) : existing.active,
      station: station ?? existing.station,
    };

    db.prepare(
      'UPDATE menu_items SET name = ?, category = ?, category_id = ?, retail_price = ?, active = ?, station = ? WHERE id = ?'
    ).run(next.name, next.category, resolveCategoryId(next.category), next.retail_price, next.active, next.station, id);
    res.json(withOptions(getMenuItem.get(id)));
  });

  // Tax-relevant category management, separate from the free-text
  // `category` field on menu items themselves — this is what the Daily
  // Sales Summary's Food/Liquor/Wine/Beer split reads.
  router.get('/categories', requireAuth, (_req, res) => {
    res.json(listCategories.all());
  });

  router.patch('/categories/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getCategory.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'menu category not found' });
    }
    const { tax_category: taxCategory } = req.body ?? {};
    if (!VALID_TAX_CATEGORIES.includes(taxCategory)) {
      return res.status(400).json({ error: `tax_category must be one of: ${VALID_TAX_CATEGORIES.join(', ')}` });
    }
    db.prepare('UPDATE menu_categories SET tax_category = ? WHERE id = ?').run(taxCategory, id);
    res.json(getCategory.get(id));
  });

  // Soft delete only — an order_items row may still reference this item.
  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getMenuItem.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'menu item not found' });
    }
    db.prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(id);
    res.json({ ...existing, active: 0 });
  });

  router.post('/:id/image', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!getMenuItem.get(id)) {
      return res.status(404).json({ error: 'menu item not found' });
    }

    upload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message ?? 'image upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'image file is required (field name "image", jpeg/png/webp/gif, max 5MB)' });
      }

      const imageUrl = `/uploads/menu/${req.file.filename}`;
      db.prepare('UPDATE menu_items SET image_url = ? WHERE id = ?').run(imageUrl, id);
      res.json(withOptions(getMenuItem.get(id)));
    });
  });

  router.post('/:id/options', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!getMenuItem.get(id)) {
      return res.status(404).json({ error: 'menu item not found' });
    }
    const { label } = req.body ?? {};
    if (typeof label !== 'string' || label.trim() === '') {
      return res.status(400).json({ error: 'label is required' });
    }

    const { n: sortOrder } = countOptionsFor.get(id);
    insertOption.run(id, label.trim(), sortOrder);
    res.status(201).json(withOptions(getMenuItem.get(id)));
  });

  router.delete('/:id/options/:optionId', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const optionId = Number(req.params.optionId);
    if (!getOption.get(optionId, id)) {
      return res.status(404).json({ error: 'option not found' });
    }
    deleteOption.run(optionId);
    res.json(withOptions(getMenuItem.get(id)));
  });

  // Upsert — re-adding an ingredient already on the recipe just updates its
  // quantity rather than erroring, since the admin UI re-posts on edit.
  router.post('/:id/recipe', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!getMenuItem.get(id)) {
      return res.status(404).json({ error: 'menu item not found' });
    }
    const { ingredient_id: ingredientId, quantity_required: quantityRequired } = req.body ?? {};
    if (!getIngredient.get(ingredientId)) {
      return res.status(400).json({ error: 'ingredient_id is required and must reference an active ingredient' });
    }
    if (typeof quantityRequired !== 'number' || !Number.isFinite(quantityRequired) || quantityRequired <= 0) {
      return res.status(400).json({ error: 'quantity_required must be a positive number' });
    }

    if (getRecipeLine.get(id, ingredientId)) {
      updateRecipeLine.run(quantityRequired, id, ingredientId);
    } else {
      insertRecipeLine.run(id, ingredientId, quantityRequired);
    }
    res.status(201).json(withOptions(getMenuItem.get(id)));
  });

  router.delete('/:id/recipe/:ingredientId', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const ingredientId = Number(req.params.ingredientId);
    if (!getRecipeLine.get(id, ingredientId)) {
      return res.status(404).json({ error: 'recipe line not found' });
    }
    deleteRecipeLine.run(id, ingredientId);
    res.json(withOptions(getMenuItem.get(id)));
  });

  return router;
}

module.exports = { createMenuRouter };
