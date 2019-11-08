import React from 'react';
import { Mystery } from './Mystery';

const App: React.FC = () => {
  var ymlurl = '/mysteries/mystery1.yml';
  if (window.location.search) {
    const urlParams = new URLSearchParams(window.location.search);
    const url = urlParams.get('texturl');
    if (url) {
      ymlurl = url;
    }
  }

  return (
    <div>
      <div style={{height: '60px', backgroundImage: 'linear-gradient(#e8e8e8, white)', display: 'flex'}}>
        <h1 style={{fontFamily: 'Courier New', fontSize: '22px', margin: 'auto 10px', padding: '5px', flex: '4 auto', overflow: 'hidden'}}>Mystery Editor.</h1>
        <div style={{flex: '1 auto', textAlign: 'right', margin: 'auto 50px'}}>
          {/*<a style={{color: 'black', textDecoration: 'none', marginRight: '50px', paddingRight: '20px', background: 'transparent url(/links/external.png) center right no-repeat'}}>Tutorials</a>*/}
          <a href={'/mysteries/mystery.schema.json'} style={{color: 'black', textDecoration: 'none', paddingRight: '20px', background: 'transparent url(/links/external.png) center right no-repeat'}}>Schema</a>
        </div>
      </div>
      <Mystery yamlUrl={ymlurl}/>
    </div>
  );
}

export default App;
