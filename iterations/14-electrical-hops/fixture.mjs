// Data-only transcription of PRODUCT in the pinned electrical-distance proof.
// Synthetic identifiers; this is not a map of the real network.
export const product={
  schema:'data-grid-gb.transmission-network.v1',
  sites:[{code:'COWL',name:'Cowley',transmission_owner:'NGET',voltages_kv:[400,132]},{code:'DIDC',name:'Didcot',transmission_owner:'NGET',voltages_kv:[400]},{code:'STRA',name:'Strand',transmission_owner:'NGET',voltages_kv:[400]},{code:'ISLE',name:'Isolated',transmission_owner:'NGET',voltages_kv:[132]},{code:'PLCH',name:'Placeholder',transmission_owner:'NGET',voltages_kv:[400]}],
  nodes:[{node:'COWL4',site_code:'COWL',voltage_kv:400,voltage_consistent_with_site:true},{node:'COWL1',site_code:'COWL',voltage_kv:132,voltage_consistent_with_site:true},{node:'DIDC4',site_code:'DIDC',voltage_kv:400,voltage_consistent_with_site:true},{node:'STRA4',site_code:'STRA',voltage_kv:400,voltage_consistent_with_site:true},{node:'ISLE1',site_code:'ISLE',voltage_kv:132,voltage_consistent_with_site:true},{node:'PLCH4',site_code:'PLCH',voltage_kv:400,voltage_consistent_with_site:true}],
  circuits:[{node_1:'COWL4',node_2:'DIDC4',circuit_type:'OHL',transmission_owner:'NGET',winter_mva:1200,spring_mva:1100,summer_mva:900,autumn_mva:1150,r_pct_100mva:0.5,x_pct_100mva:5,b_pct_100mva:10,ohl_km:20},{node_1:'DIDC4',node_2:'STRA4',circuit_type:'OHL',transmission_owner:'NGET',winter_mva:800,spring_mva:750,summer_mva:600,autumn_mva:700,ohl_km:15},{node_1:'COWL4',node_2:'ISLE1',circuit_type:'OHL',transmission_owner:'NGET',winter_mva:500,spring_mva:480,summer_mva:400,autumn_mva:450},{node_1:'COWL4',node_2:'PLCH4',circuit_type:'OHL',transmission_owner:'NGET',winter_mva:9999,spring_mva:100,summer_mva:90,autumn_mva:95}],
  transformers:[{node_1:'COWL4',node_2:'COWL1',rating_mva:240,transmission_owner:'NGET'}],
  planned_changes:[{node_1:'STRA4',node_2:'FUTR1',year:2029,status:'proposed',asset:'new circuit'}]
};
