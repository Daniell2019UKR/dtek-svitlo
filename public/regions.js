export const regionNames=Object.freeze({
 o:'Одеса та область', k:'Київ', kr:'Київська область',
 dn:'Дніпропетровська область · ДТЕК', d:'Донецька область',
 vinnytsia:'Вінницька область', volyn:'Волинська область',
 cek:'Дніпропетровська область · ЦЕК', zhytomyr:'Житомирська область',
 zakarpattia:'Закарпатська область', zaporizhzhia:'Запорізька область',
 'ivano-frankivsk':'Івано-Франківська область', kirovohrad:'Кіровоградська область',
 lviv:'Львівська область', mykolaiv:'Миколаївська область',
 poltava:'Полтавська область', rivne:'Рівненська область',
 sumy:'Сумська область', ternopil:'Тернопільська область',
 kharkiv:'Харківська область', khmelnytskyi:'Хмельницька область',
 cherkasy:'Черкаська область', chernivtsi:'Чернівецька область',
 chernihiv:'Чернігівська область'
});
export const isRegion=code=>Object.hasOwn(regionNames,code);
export const standardGroups=Object.freeze(Array.from({length:12},(_,i)=>`${Math.floor(i/2)+1}.${i%2+1}`));
export const isGroup=group=>typeof group==='string'&&/^[1-9]\d?\.[1-9]\d?$/.test(group);
export const sortGroups=groups=>[...new Set(groups)].sort((a,b)=>a.localeCompare(b,'uk',{numeric:true}));
export function availableGroups(snapshot){
 const published=snapshot?.current?.days??snapshot?.days??[];
 const groups=sortGroups(published.flatMap(day=>Object.keys(day.groups??{})));
 return groups.length?groups:snapshot?.region==='k'?Array.from({length:60},(_,i)=>`${i+1}.1`):standardGroups;
}
