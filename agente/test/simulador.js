// Impresora falsa por SNMP para las pruebas: responde exactamente los OID que se le cargan.
import snmp from 'net-snmp';

export function simularImpresora({ address = '127.0.0.1', port, valores }) {
  return new Promise((resolve) => {
    const agente = snmp.createAgent({ port, address, disableAuthorization: true, accessControlModelType: snmp.AccessControlModelType.None }, () => {});
    agente.getAuthorizer().addCommunity('public');
    const mib = agente.getMib(); const padres = new Set();
    for (const [oid, v] of Object.entries(valores)) {
      const padre = oid.split('.').slice(0, -1).join('.');
      const tipo = oid === '1.3.6.1.2.1.1.2.0' ? snmp.ObjectType.OID : typeof v === 'number' ? snmp.ObjectType.Counter32 : snmp.ObjectType.OctetString; // Buffer o texto: OctetString
      if (!padres.has(padre)) {
        padres.add(padre);
        const p = { name: `p_${padre}`, type: snmp.MibProviderType.Scalar, oid: padre, scalarType: tipo, maxAccess: snmp.MaxAccess['read-only'] };
        mib.registerProvider(p); mib.addProviderToNode(p);
      }
      const nodo = mib.addNodesForOid(oid); nodo.valueType = tipo; nodo.value = v;
    }
    setTimeout(() => resolve({ cerrar: () => agente.close() }), 50);
  });
}
