function normalizeCep(cep) {
  return String(cep ?? '').replace(/\D/g, '');
}

export async function fetchAddressByCep(cep) {
  const normalizedCep = normalizeCep(cep);

  if (normalizedCep.length !== 8) {
    throw new Error('Informe um CEP válido com 8 dígitos.');
  }

  const response = await fetch(`https://viacep.com.br/ws/${normalizedCep}/json/`);

  if (!response.ok) {
    throw new Error('Não foi possível consultar o CEP agora.');
  }

  const data = await response.json();

  if (data.erro) {
    throw new Error('CEP não encontrado.');
  }

  return {
    street: data.logradouro ?? '',
    neighborhood: data.bairro ?? '',
    city: data.localidade ?? '',
    state: data.uf ?? '',
    fullAddress: [
      data.logradouro,
      data.bairro,
      data.localidade && data.uf ? `${data.localidade} - ${data.uf}` : data.localidade ?? data.uf,
    ].filter(Boolean).join(', '),
  };
}
