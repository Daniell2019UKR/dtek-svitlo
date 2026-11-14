export const regionNames=Object.freeze({
 o:'Одеса та область', k:'Київ', kr:'Київська область',
 dn:'Дніпропетровська область', d:'Донецька область'
});
export const isRegion=code=>Object.hasOwn(regionNames,code);
