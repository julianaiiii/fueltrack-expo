import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';
type Tab = 'dashboard' | 'scanner' | 'settings';

type Food = {
  id: string;
  date: string;
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving: string;
  meal: Meal;
};

type Product = {
  barcode: string;
  name: string;
  brand: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingGrams: number;
  servingUnit: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  source: 'openfoodfacts' | 'custom';
};

type Goals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

const STORAGE = {
  foods: 'fueltrack.native.foods.v1',
  products: 'fueltrack.native.products.v1',
  goals: 'fueltrack.native.goals.v1',
  dark: 'fueltrack.native.dark.v1',
};

const defaultGoals: Goals = { calories: 2000, protein: 120, carbs: 250, fat: 70 };
const meals: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const mealLabels: Record<Meal, string> = {
  Breakfast: 'Frühstück',
  Lunch: 'Mittagessen',
  Dinner: 'Abendessen',
  Snacks: 'Snacks',
};

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function lastSevenDays() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - index));
    return dateKey(day);
  });
}

function inferUnit(text: string) {
  const value = text.toLowerCase();
  if (/scheibe|slice/.test(value)) return 'Scheibe';
  if (/riegel|bar\b/.test(value)) return 'Riegel';
  if (/becher|cup/.test(value)) return 'Becher';
  if (/flasche|bottle/.test(value)) return 'Flasche';
  if (/dose|can\b/.test(value)) return 'Dose';
  if (/stück|stueck|piece|cookie|keks/.test(value)) return 'Stück';
  return 'Portion';
}

function parseServingGrams(serving?: string, quantity?: number) {
  if (quantity && Number.isFinite(quantity) && quantity > 0) return Math.round(quantity);
  const match = serving?.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!match) return 100;
  return Math.max(1, Math.round(Number(match[1].replace(',', '.'))));
}

function normalizeProduct(raw: any): Product | null {
  const name = String(raw?.product_name || '').trim();
  if (!name) return null;
  const n = raw?.nutriments || {};
  const servingGrams = parseServingGrams(raw?.serving_size, Number(raw?.serving_quantity));
  const kcal100 = Number(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0);
  const protein100 = Number(n.proteins_100g ?? n.proteins ?? 0);
  const carbs100 = Number(n.carbohydrates_100g ?? n.carbohydrates ?? 0);
  const fat100 = Number(n.fat_100g ?? n.fat ?? 0);
  const scale = servingGrams / 100;
  return {
    barcode: String(raw?.code || ''),
    name,
    brand: String(raw?.brands || ''),
    calories: Number(n['energy-kcal_serving']) || kcal100 * scale,
    protein: Number.isFinite(Number(n.proteins_serving)) ? Number(n.proteins_serving) : protein100 * scale,
    carbs: Number.isFinite(Number(n.carbohydrates_serving)) ? Number(n.carbohydrates_serving) : carbs100 * scale,
    fat: Number.isFinite(Number(n.fat_serving)) ? Number(n.fat_serving) : fat100 * scale,
    servingGrams,
    servingUnit: inferUnit(`${raw?.serving_size || ''} ${name} ${(raw?.categories_tags || []).join(' ')}`),
    caloriesPer100g: kcal100,
    proteinPer100g: protein100,
    carbsPer100g: carbs100,
    fatPer100g: fat100,
    source: 'openfoodfacts',
  };
}

function nutritionFor(product: Product, grams: number) {
  const safe = Math.max(1, grams);
  const scale100 = safe / 100;
  const scaleServing = safe / Math.max(1, product.servingGrams);
  return {
    calories: product.caloriesPer100g > 0 ? product.caloriesPer100g * scale100 : product.calories * scaleServing,
    protein: product.proteinPer100g >= 0 ? product.proteinPer100g * scale100 : product.protein * scaleServing,
    carbs: product.carbsPer100g >= 0 ? product.carbsPer100g * scale100 : product.carbs * scaleServing,
    fat: product.fatPer100g >= 0 ? product.fatPer100g * scale100 : product.fat * scaleServing,
  };
}

function unitLabel(product: Product, grams: number) {
  const amount = Math.round((grams / Math.max(1, product.servingGrams)) * 4) / 4;
  const plural: Record<string, string> = {
    Portion: 'Portionen', Scheibe: 'Scheiben', Stück: 'Stück', Riegel: 'Riegel',
    Becher: 'Becher', Flasche: 'Flaschen', Dose: 'Dosen', Packung: 'Packungen',
  };
  return `${String(amount).replace('.', ',')} ${amount === 1 ? product.servingUnit : plural[product.servingUnit] || product.servingUnit}`;
}

async function searchOpenFoodFacts(term: string): Promise<Product[]> {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,brands,serving_size,serving_quantity,categories_tags,nutriments`;
  const response = await fetch(url, { headers: { 'User-Agent': 'FuelTrackNative/1.0' } });
  if (!response.ok) throw new Error('search_failed');
  const json = await response.json();
  return (json?.products || []).map(normalizeProduct).filter(Boolean) as Product[];
}

async function productByBarcode(code: string): Promise<Product | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,brands,serving_size,serving_quantity,categories_tags,nutriments`;
  const response = await fetch(url, { headers: { 'User-Agent': 'FuelTrackNative/1.0' } });
  if (!response.ok) return null;
  const json = await response.json();
  return json?.status === 1 ? normalizeProduct(json.product) : null;
}

export default function App() {
  const systemScheme = useColorScheme();
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(systemScheme !== 'light');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [foods, setFoods] = useState<Food[]>([]);
  const [customProducts, setCustomProducts] = useState<Product[]>([]);
  const [goals, setGoals] = useState<Goals>(defaultGoals);
  const [mealModal, setMealModal] = useState<Meal | null>(null);
  const week = useMemo(lastSevenDays, []);
  const c = dark ? darkColors : lightColors;

  useEffect(() => {
    (async () => {
      const [foodsRaw, productsRaw, goalsRaw, darkRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE.foods),
        AsyncStorage.getItem(STORAGE.products),
        AsyncStorage.getItem(STORAGE.goals),
        AsyncStorage.getItem(STORAGE.dark),
      ]);
      if (foodsRaw) setFoods(JSON.parse(foodsRaw));
      if (productsRaw) setCustomProducts(JSON.parse(productsRaw));
      if (goalsRaw) setGoals({ ...defaultGoals, ...JSON.parse(goalsRaw) });
      if (darkRaw !== null) setDark(darkRaw === '1');
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, []);

  useEffect(() => { if (loaded) AsyncStorage.setItem(STORAGE.foods, JSON.stringify(foods)); }, [foods, loaded]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORAGE.products, JSON.stringify(customProducts)); }, [customProducts, loaded]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORAGE.goals, JSON.stringify(goals)); }, [goals, loaded]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORAGE.dark, dark ? '1' : '0'); }, [dark, loaded]);

  const dayFoods = foods.filter(item => item.date === selectedDate);
  const totals = dayFoods.reduce((sum, item) => ({
    calories: sum.calories + item.calories,
    protein: sum.protein + item.protein,
    carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  function addFood(food: Omit<Food, 'id' | 'date'>) {
    setFoods(current => [...current, { ...food, id: `${Date.now()}-${Math.random()}`, date: selectedDate }]);
    setMealModal(null);
  }

  function saveCustom(product: Product) {
    setCustomProducts(current => [product, ...current.filter(p => p.name.toLowerCase() !== product.name.toLowerCase())].slice(0, 500));
  }

  if (!loaded) {
    return <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}><ActivityIndicator color={c.accent} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}> 
      <StatusBar style={dark ? 'light' : 'dark'} />
      {tab === 'dashboard' && (
        <Dashboard
          c={c}
          dark={dark}
          setDark={setDark}
          week={week}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          foods={foods}
          dayFoods={dayFoods}
          totals={totals}
          goals={goals}
          onMeal={setMealModal}
          removeFood={id => setFoods(current => current.filter(f => f.id !== id))}
        />
      )}
      {tab === 'scanner' && <Scanner c={c} onAdd={food => { addFood(food); setTab('dashboard'); }} />}
      {tab === 'settings' && <SettingsScreen c={c} goals={goals} setGoals={setGoals} dark={dark} setDark={setDark} />}

      <View style={[styles.nav, { backgroundColor: c.card, borderColor: c.border }]}> 
        <NavItem label='Übersicht' active={tab === 'dashboard'} c={c} onPress={() => setTab('dashboard')} />
        <Pressable onPress={() => setTab('scanner')} style={[styles.scanButton, { backgroundColor: c.accent }]}>
          <Text style={styles.scanButtonText}>▣</Text>
        </Pressable>
        <NavItem label='Einstellungen' active={tab === 'settings'} c={c} onPress={() => setTab('settings')} />
      </View>

      <Modal visible={mealModal !== null} animationType='slide' presentationStyle='pageSheet' onRequestClose={() => setMealModal(null)}>
        {mealModal && (
          <AddFoodScreen
            c={c}
            meal={mealModal}
            customProducts={customProducts}
            onSaveCustom={saveCustom}
            onAdd={addFood}
            onClose={() => setMealModal(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function Dashboard(props: any) {
  const { c, dark, setDark, week, selectedDate, setSelectedDate, foods, dayFoods, totals, goals, onMeal, removeFood } = props;
  const remaining = Math.max(0, goals.calories - totals.calories);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerRow}>
        <View><Text style={[styles.eyebrow, { color: c.muted }]}>HEUTE</Text><Text style={[styles.title, { color: c.text }]}>FuelTrack</Text></View>
        <Pressable onPress={() => setDark(!dark)} style={[styles.iconButton, { backgroundColor: c.card }]}><Text style={{ fontSize: 20 }}>{dark ? '☀️' : '🌙'}</Text></Pressable>
      </View>
      <View style={styles.weekRow}>
        {week.map((key: string) => {
          const d = dateFromKey(key); const active = key === selectedDate; const has = foods.some((f: Food) => f.date === key);
          return <Pressable key={key} onPress={() => setSelectedDate(key)} style={[styles.dayChip, { backgroundColor: active ? c.accent : c.card }]}>
            <Text style={[styles.daySmall, { color: active ? '#142019' : c.muted }]}>{d.toLocaleDateString('de-DE',{weekday:'short'}).replace('.','')}</Text>
            <Text style={[styles.dayNum, { color: active ? '#142019' : c.text }]}>{d.getDate()}</Text>
            <View style={[styles.dot, { backgroundColor: has ? (active ? '#142019' : c.accent) : 'transparent' }]} />
          </Pressable>;
        })}
      </View>
      <View style={[styles.hero, { backgroundColor: '#17221a' }]}>
        <Text style={styles.heroMuted}>Noch verfügbar</Text><Text style={styles.heroNumber}>{Math.round(remaining)}</Text><Text style={styles.heroUnit}>kcal</Text>
        <Text style={styles.heroMuted}>{Math.round(totals.calories)} von {goals.calories} kcal gegessen</Text>
      </View>
      <View style={styles.macroRow}>
        <Macro c={c} label='Protein' value={totals.protein} goal={goals.protein} />
        <Macro c={c} label='Kohlenhydrate' value={totals.carbs} goal={goals.carbs} />
        <Macro c={c} label='Fett' value={totals.fat} goal={goals.fat} />
      </View>
      <Text style={[styles.sectionTitle, { color: c.text }]}>Mahlzeiten</Text>
      {meals.map(meal => {
        const entries = dayFoods.filter((f: Food) => f.meal === meal);
        return <View key={meal} style={[styles.mealCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.mealHeader}><View><Text style={[styles.mealTitle,{color:c.text}]}>{mealLabels[meal]}</Text><Text style={{color:c.muted,fontSize:12}}>{Math.round(entries.reduce((s:number,f:Food)=>s+f.calories,0))} kcal</Text></View><Pressable onPress={() => onMeal(meal)} style={[styles.addRound,{backgroundColor:c.soft}]}><Text style={[styles.plus,{color:c.text}]}>+</Text></Pressable></View>
          {entries.length === 0 ? <Pressable onPress={() => onMeal(meal)} style={[styles.emptyRow,{backgroundColor:c.soft}]}><Text style={{color:c.muted}}>Noch nichts eingetragen</Text><Text style={{color:c.muted}}>›</Text></Pressable> : entries.map((food:Food) => <View key={food.id} style={[styles.foodRow,{backgroundColor:c.soft}]}><View style={{flex:1}}><Text numberOfLines={1} style={[styles.foodName,{color:c.text}]}>{food.name}</Text><Text style={{color:c.muted,fontSize:11}}>{food.serving}</Text></View><Text style={[styles.kcal,{color:c.text}]}>{Math.round(food.calories)} kcal</Text><Pressable onPress={() => removeFood(food.id)}><Text style={{color:c.muted,fontSize:17}}>×</Text></Pressable></View>)}
        </View>;
      })}
    </ScrollView>
  );
}

function Macro({ c, label, value, goal }: any) {
  const progress = Math.min(1, value / Math.max(1, goal));
  return <View style={[styles.macro,{backgroundColor:c.card,borderColor:c.border}]}><Text numberOfLines={1} style={{color:c.muted,fontWeight:'700',fontSize:10}}>{label}</Text><Text style={[styles.macroValue,{color:c.text}]}>{Math.round(value)}<Text style={{fontSize:11,color:c.muted}}>g</Text></Text><View style={[styles.progress,{backgroundColor:c.soft}]}><View style={[styles.progressFill,{width:`${progress*100}%`,backgroundColor:c.accent}]} /></View><Text style={{fontSize:9,color:c.muted}}>Ziel {goal}g</Text></View>;
}

function AddFoodScreen({ c, meal, customProducts, onSaveCustom, onAdd, onClose }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [grams, setGrams] = useState(100);
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [servingGrams, setServingGrams] = useState('100');
  const [unit, setUnit] = useState('Portion');
  const [saveCustom, setSaveCustom] = useState(false);
  const requestRef = useRef(0);

  const own = customProducts.filter((p:Product) => query && `${p.name} ${p.brand}`.toLowerCase().includes(query.toLowerCase())).slice(0,5);

  useEffect(() => {
    if (query.trim().length < 2 || selected) { setResults([]); return; }
    const id = ++requestRef.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try { const list = await searchOpenFoodFacts(query.trim()); if (id === requestRef.current) setResults(list); }
      catch { if (id === requestRef.current) setResults([]); }
      finally { if (id === requestRef.current) setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selected]);

  function choose(p: Product) { setSelected(p); setQuery(p.name); setGrams(p.servingGrams); setResults([]); }
  function addSelected() { if (!selected) return; const n = nutritionFor(selected, grams); onAdd({name:selected.name,brand:selected.brand,calories:n.calories,protein:n.protein,carbs:n.carbs,fat:n.fat,serving:`${unitLabel(selected,grams)} · ${grams} g`,meal}); }
  function addManual() {
    if (!name.trim() || !calories) { Alert.alert('Fehlende Angaben','Bitte Name und Kalorien angeben.'); return; }
    const g = Math.max(1, Number(servingGrams)||100); const kcal=Number(calories)||0; const pr=Number(protein)||0; const ca=Number(carbs)||0; const fa=Number(fat)||0;
    if (saveCustom) onSaveCustom({barcode:`custom-${Date.now()}`,name:name.trim(),brand:'Mein Produkt',calories:kcal,protein:pr,carbs:ca,fat:fa,servingGrams:g,servingUnit:unit,caloriesPer100g:kcal/g*100,proteinPer100g:pr/g*100,carbsPer100g:ca/g*100,fatPer100g:fa/g*100,source:'custom'});
    onAdd({name:name.trim(),brand:saveCustom?'Mein Produkt':'',calories:kcal,protein:pr,carbs:ca,fat:fa,serving:`1 ${unit} · ${g} g`,meal});
  }

  return <SafeAreaView style={[styles.safe,{backgroundColor:c.bg}]}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps='handled'>
    <View style={styles.modalHeader}><Text style={[styles.modalTitle,{color:c.text}]}>Zu {mealLabels[meal]} hinzufügen</Text><Pressable onPress={onClose}><Text style={{color:c.text,fontSize:25}}>×</Text></Pressable></View>
    <Text style={[styles.label,{color:c.text}]}>Lebensmittel suchen</Text><TextInput value={query} onChangeText={t=>{setQuery(t);if(selected&&t!==selected.name)setSelected(null);}} placeholder='z. B. Skyr, Hafermilch, Nutella' placeholderTextColor={c.muted} style={[styles.input,{backgroundColor:c.card,color:c.text,borderColor:c.border}]} />
    {own.length>0 && <View style={[styles.resultBox,{backgroundColor:c.soft}]}><Text style={[styles.resultHeading,{color:c.accent}]}>MEINE PRODUKTE</Text>{own.map((p:Product)=><ResultRow key={p.barcode} c={c} p={p} onPress={()=>choose(p)} />)}</View>}
    {searching && <ActivityIndicator color={c.accent} style={{margin:12}} />}
    {results.length>0 && <View style={[styles.resultBox,{backgroundColor:c.card}]}>{results.slice(0,8).map(p=><ResultRow key={`${p.barcode}-${p.name}`} c={c} p={p} onPress={()=>choose(p)} />)}</View>}
    {selected ? <ProductQuantity c={c} product={selected} grams={grams} setGrams={setGrams} onAdd={addSelected} /> : <View style={{marginTop:18}}><Text style={[styles.sectionTitle,{color:c.text}]}>Eigenes Produkt</Text>
      <TextInput value={name} onChangeText={setName} placeholder='Produktname' placeholderTextColor={c.muted} style={[styles.input,{backgroundColor:c.card,color:c.text,borderColor:c.border}]} />
      <View style={styles.twoCol}><Numeric c={c} label='Kalorien' value={calories} onChange={setCalories}/><Numeric c={c} label='g pro Portion' value={servingGrams} onChange={setServingGrams}/><Numeric c={c} label='Protein' value={protein} onChange={setProtein}/><Numeric c={c} label='Kohlenhydrate' value={carbs} onChange={setCarbs}/><Numeric c={c} label='Fett' value={fat} onChange={setFat}/></View>
      <Text style={[styles.label,{color:c.text}]}>Einheit</Text><View style={styles.unitWrap}>{['Portion','Scheibe','Stück','Becher','Riegel'].map(x=><Pressable key={x} onPress={()=>setUnit(x)} style={[styles.unitChip,{backgroundColor:unit===x?c.accent:c.card}]}><Text style={{fontWeight:'800',color:unit===x?'#142019':c.text}}>{x}</Text></Pressable>)}</View>
      <View style={[styles.switchRow,{backgroundColor:c.card}]}><View style={{flex:1}}><Text style={[styles.foodName,{color:c.text}]}>Als eigenes Produkt speichern</Text><Text style={{color:c.muted,fontSize:11}}>Nur mit Haken wird es später wieder vorgeschlagen.</Text></View><Switch value={saveCustom} onValueChange={setSaveCustom} trackColor={{true:c.accent}} /></View>
      <Pressable onPress={addManual} style={[styles.primary,{backgroundColor:c.accent}]}><Text style={styles.primaryText}>Lebensmittel hinzufügen</Text></Pressable>
    </View>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function ResultRow({ c, p, onPress }: any) { return <Pressable onPress={onPress} style={[styles.resultRow,{borderColor:c.border}]}><View style={{flex:1}}><Text style={[styles.foodName,{color:c.text}]} numberOfLines={1}>{p.name}</Text><Text style={{color:c.muted,fontSize:11}}>{p.brand||'Open Food Facts'} · {Math.round(p.calories)} kcal · {unitLabel(p,p.servingGrams)}</Text></View><Text style={{color:c.accent,fontSize:24}}>+</Text></Pressable>; }

function ProductQuantity({ c, product, grams, setGrams, onAdd }: any) {
  const [mode,setMode]=useState<'unit'|'grams'>('unit'); const n=nutritionFor(product,grams); const unitValue=Math.max(.25,Math.round(grams/product.servingGrams*4)/4);
  return <View style={{marginTop:16}}><View style={[styles.quantityCard,{backgroundColor:'#17221a'}]}><View style={styles.toggle}><Pressable onPress={()=>setMode('unit')} style={[styles.togglePart,{backgroundColor:mode==='unit'?c.accent:'transparent'}]}><Text style={{fontWeight:'900',color:mode==='unit'?'#142019':'#fff'}}>{product.servingUnit}</Text></Pressable><Pressable onPress={()=>setMode('grams')} style={[styles.togglePart,{backgroundColor:mode==='grams'?c.accent:'transparent'}]}><Text style={{fontWeight:'900',color:mode==='grams'?'#142019':'#fff'}}>Gramm</Text></Pressable></View><Text style={styles.quantityBig}>{mode==='unit'?unitLabel(product,grams):Math.round(grams)}</Text><Text style={styles.quantitySub}>{mode==='unit'?`${Math.round(grams)} g`:'Gramm'}</Text><Slider minimumValue={mode==='unit'?.25:1} maximumValue={mode==='unit'?10:500} step={mode==='unit'?.25:1} value={mode==='unit'?unitValue:grams} onValueChange={v=>setGrams(mode==='unit'?Math.round(v*product.servingGrams):Math.round(v))} minimumTrackTintColor={c.accent} maximumTrackTintColor='#526056' thumbTintColor={c.accent}/></View>
    <View style={styles.nutrientRow}><Nutrient c={c} label='kcal' value={Math.round(n.calories)}/><Nutrient c={c} label='Protein' value={`${n.protein.toFixed(1)}g`}/><Nutrient c={c} label='Kohlenh.' value={`${n.carbs.toFixed(1)}g`}/><Nutrient c={c} label='Fett' value={`${n.fat.toFixed(1)}g`}/></View><Pressable onPress={onAdd} style={[styles.primary,{backgroundColor:c.accent}]}><Text style={styles.primaryText}>Hinzufügen</Text></Pressable></View>;
}

function Nutrient({c,label,value}:any){return <View style={[styles.nutrient,{backgroundColor:c.card}]}><Text style={[styles.nutrientValue,{color:c.text}]}>{value}</Text><Text style={{fontSize:8,color:c.muted,fontWeight:'800'}}>{label}</Text></View>}
function Numeric({c,label,value,onChange}:any){return <View style={{width:'48%'}}><Text style={[styles.label,{color:c.text}]}>{label}</Text><TextInput keyboardType='decimal-pad' value={value} onChangeText={onChange} style={[styles.input,{backgroundColor:c.card,color:c.text,borderColor:c.border}]} /></View>}

function Scanner({ c, onAdd }: any) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked,setLocked]=useState(false); const [product,setProduct]=useState<Product|null>(null); const [grams,setGrams]=useState(100); const [loading,setLoading]=useState(false); const [manual,setManual]=useState('');
  useEffect(()=>{ if(permission && !permission.granted) requestPermission(); },[permission]);
  async function find(code:string){if(!code||loading)return;setLoading(true);setLocked(true);const p=await productByBarcode(code).catch(()=>null);setLoading(false);if(p){setProduct(p);setGrams(p.servingGrams);}else{Alert.alert('Nicht gefunden','Das Produkt wurde bei Open Food Facts nicht gefunden.');setLocked(false);}}
  if(!permission) return <View style={[styles.center,{backgroundColor:c.bg}]}><ActivityIndicator color={c.accent}/></View>;
  return <ScrollView style={{flex:1}} contentContainerStyle={styles.scrollContent}><Text style={[styles.title,{color:c.text}]}>Produkt scannen</Text><View style={styles.cameraWrap}>{permission.granted?<CameraView style={styles.camera} facing='back' barcodeScannerSettings={{barcodeTypes:['ean13','ean8','upc_a','upc_e']}} onBarcodeScanned={locked?undefined:({data})=>find(data)} />:<Pressable onPress={requestPermission} style={[styles.cameraFallback,{backgroundColor:'#17221a'}]}><Text style={{color:'#fff',fontWeight:'800'}}>Kamerazugriff erlauben</Text></Pressable>}{loading&&<View style={styles.cameraOverlay}><ActivityIndicator color={c.accent}/><Text style={{color:'#fff',marginTop:8}}>Produkt wird automatisch gesucht …</Text></View>}</View>
    <View style={styles.manualRow}><TextInput keyboardType='number-pad' value={manual} onChangeText={setManual} placeholder='Barcode manuell eingeben' placeholderTextColor={c.muted} style={[styles.input,{flex:1,backgroundColor:c.card,color:c.text,borderColor:c.border}]} /><Pressable onPress={()=>find(manual)} style={[styles.smallButton,{backgroundColor:c.accent}]}><Text style={styles.primaryText}>Suchen</Text></Pressable></View>
    {product&&<ProductQuantity c={c} product={product} grams={grams} setGrams={setGrams} onAdd={()=>{const n=nutritionFor(product,grams);onAdd({name:product.name,brand:product.brand,calories:n.calories,protein:n.protein,carbs:n.carbs,fat:n.fat,serving:`${unitLabel(product,grams)} · ${grams} g`,meal:'Snacks'});setProduct(null);setLocked(false);}}/>}
    {locked&&!product&&!loading&&<Pressable onPress={()=>setLocked(false)} style={[styles.secondary,{borderColor:c.border}]}><Text style={{color:c.text,fontWeight:'800'}}>Erneut scannen</Text></Pressable>}
  </ScrollView>;
}

function SettingsScreen({c,goals,setGoals,dark,setDark}:any){return <ScrollView style={{flex:1}} contentContainerStyle={styles.scrollContent}><Text style={[styles.title,{color:c.text}]}>Einstellungen</Text><View style={[styles.settingsCard,{backgroundColor:c.card}]}><Text style={[styles.sectionTitle,{color:c.text}]}>Tagesziele</Text><Goal c={c} label='Kalorien' unit='kcal' value={goals.calories} setValue={(v:number)=>setGoals({...goals,calories:v})}/><Goal c={c} label='Protein' unit='g' value={goals.protein} setValue={(v:number)=>setGoals({...goals,protein:v})}/><Goal c={c} label='Kohlenhydrate' unit='g' value={goals.carbs} setValue={(v:number)=>setGoals({...goals,carbs:v})}/><Goal c={c} label='Fett' unit='g' value={goals.fat} setValue={(v:number)=>setGoals({...goals,fat:v})}/></View><View style={[styles.switchRow,{backgroundColor:c.card}]}><Text style={[styles.foodName,{color:c.text}]}>Dark Mode</Text><Switch value={dark} onValueChange={setDark} trackColor={{true:c.accent}}/></View><View style={[styles.note,{backgroundColor:c.soft}]}><Text style={{color:c.muted,lineHeight:19}}>Account-Sync und Apple Health sind für die nächste native Ausbaustufe vorgesehen. Apple Health benötigt einen Expo Development Build und funktioniert nicht direkt in Expo Go.</Text></View></ScrollView>}
function Goal({c,label,unit,value,setValue}:any){return <View style={styles.goalRow}><View style={{flex:1}}><Text style={[styles.foodName,{color:c.text}]}>{label}</Text><Text style={{color:c.muted,fontSize:11}}>Tagesziel</Text></View><TextInput keyboardType='number-pad' value={String(value)} onChangeText={t=>{const n=Number(t);if(n>0)setValue(n)}} style={[styles.goalInput,{backgroundColor:c.soft,color:c.text}]} /><Text style={{color:c.muted,fontWeight:'700'}}>{unit}</Text></View>}
function NavItem({label,active,c,onPress}:any){return <Pressable onPress={onPress} style={styles.navItem}><Text style={{color:active?c.accent:c.muted,fontWeight:'900',fontSize:12}}>{label}</Text></Pressable>}

const darkColors={bg:'#09100c',card:'#131c16',soft:'#0d140f',text:'#eef5ef',muted:'#8c9a90',accent:'#a7ef5b',border:'#243129'};
const lightColors={bg:'#f2f5ef',card:'#ffffff',soft:'#f6f8f4',text:'#152018',muted:'#7d8a81',accent:'#a7ef5b',border:'#e5eae2'};

const styles=StyleSheet.create({safe:{flex:1},center:{flex:1,alignItems:'center',justifyContent:'center'},scrollContent:{padding:18,paddingBottom:110},headerRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:16},eyebrow:{fontSize:11,fontWeight:'900',letterSpacing:1.5},title:{fontSize:31,fontWeight:'900',letterSpacing:-1},iconButton:{width:46,height:46,borderRadius:16,alignItems:'center',justifyContent:'center'},weekRow:{flexDirection:'row',gap:5,marginBottom:14},dayChip:{flex:1,borderRadius:15,paddingVertical:8,alignItems:'center'},daySmall:{fontSize:9,fontWeight:'900'},dayNum:{fontSize:15,fontWeight:'900',marginTop:2},dot:{width:5,height:5,borderRadius:5,marginTop:4},hero:{borderRadius:28,padding:20,marginBottom:12},heroMuted:{color:'#9ba59e',fontSize:13,fontWeight:'600'},heroNumber:{fontSize:48,fontWeight:'900',color:'#fff',letterSpacing:-2,marginTop:3},heroUnit:{color:'#a7ef5b',fontWeight:'900',marginBottom:6},macroRow:{flexDirection:'row',gap:8,marginBottom:20},macro:{flex:1,borderRadius:20,padding:12,borderWidth:1},macroValue:{fontSize:18,fontWeight:'900',marginTop:7},progress:{height:5,borderRadius:5,overflow:'hidden',marginVertical:7},progressFill:{height:'100%'},sectionTitle:{fontSize:18,fontWeight:'900',marginBottom:10},mealCard:{padding:14,borderRadius:23,borderWidth:1,marginBottom:10},mealHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10},mealTitle:{fontSize:16,fontWeight:'900'},addRound:{width:35,height:35,borderRadius:12,alignItems:'center',justifyContent:'center'},plus:{fontSize:22,fontWeight:'800'},emptyRow:{padding:13,borderRadius:14,flexDirection:'row',justifyContent:'space-between'},foodRow:{padding:12,borderRadius:14,flexDirection:'row',alignItems:'center',gap:10,marginBottom:6},foodName:{fontWeight:'800',fontSize:14},kcal:{fontWeight:'900',fontSize:12},nav:{position:'absolute',left:0,right:0,bottom:0,height:82,borderTopWidth:1,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingBottom:10},navItem:{width:110,alignItems:'center',justifyContent:'center',height:55},scanButton:{width:70,height:54,borderRadius:18,alignItems:'center',justifyContent:'center'},scanButtonText:{fontSize:27,fontWeight:'900',color:'#142019'},modalContent:{padding:18,paddingBottom:50},modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:18},modalTitle:{fontSize:22,fontWeight:'900',flex:1},label:{fontSize:12,fontWeight:'800',marginBottom:6,marginTop:8},input:{borderWidth:1,borderRadius:15,paddingHorizontal:13,paddingVertical:12,fontSize:15},resultBox:{borderRadius:16,padding:7,marginTop:8},resultHeading:{fontSize:9,fontWeight:'900',letterSpacing:1.2,padding:7},resultRow:{flexDirection:'row',alignItems:'center',gap:8,padding:10,borderBottomWidth:StyleSheet.hairlineWidth},twoCol:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between'},unitWrap:{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12},unitChip:{paddingHorizontal:11,paddingVertical:9,borderRadius:12},switchRow:{padding:14,borderRadius:17,flexDirection:'row',alignItems:'center',gap:12,marginTop:10},primary:{padding:15,borderRadius:17,alignItems:'center',marginTop:14},primaryText:{fontWeight:'900',color:'#142019'},quantityCard:{borderRadius:24,padding:16},toggle:{flexDirection:'row',backgroundColor:'#ffffff12',borderRadius:14,padding:3,marginBottom:15},togglePart:{flex:1,padding:9,borderRadius:11,alignItems:'center'},quantityBig:{fontSize:36,fontWeight:'900',color:'#a7ef5b',textAlign:'center'},quantitySub:{color:'#a7b0aa',textAlign:'center',fontWeight:'700',marginBottom:8},nutrientRow:{flexDirection:'row',gap:6,marginTop:10},nutrient:{flex:1,padding:9,borderRadius:14,alignItems:'center'},nutrientValue:{fontWeight:'900',fontSize:12},cameraWrap:{height:380,borderRadius:26,overflow:'hidden',backgroundColor:'#17221a',marginTop:14},camera:{flex:1},cameraFallback:{flex:1,alignItems:'center',justifyContent:'center'},cameraOverlay:{...StyleSheet.absoluteFillObject,backgroundColor:'#0008',alignItems:'center',justifyContent:'center'},manualRow:{flexDirection:'row',gap:8,marginTop:10},smallButton:{paddingHorizontal:16,borderRadius:15,alignItems:'center',justifyContent:'center'},secondary:{padding:14,borderRadius:16,borderWidth:1,alignItems:'center',marginTop:10},settingsCard:{padding:16,borderRadius:24,marginTop:16},goalRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:10},goalInput:{width:75,padding:9,borderRadius:12,textAlign:'right',fontWeight:'900'},note:{padding:15,borderRadius:18,marginTop:12}});
