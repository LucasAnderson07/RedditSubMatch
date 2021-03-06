import * as React from 'react';
import * as qs from 'query-string'
import { firebaseFunctions } from 'app/firebase/base';
import Optout from './Optout';
import Optin from './Optin';
import { Loading } from './Loading';
import { Error } from './Error';
import { Blacklist } from './Blacklist';
import { SubredditFiltering } from './SubredditFiltering';

export const Redirect = (props) => {
  const data = { code: qs.parse(props.location.search).code, testing: false };
  const [loading, setLoading] = React.useState(true);
  const [response, setResponse] = React.useState({});
  const [subreddits, setSubreddits] = React.useState([]);
  const [accessToken, setAccessToken] = React.useState('');
  const [exclusionSubList, setExclusionSubList] = React.useState([]);
  const optOut = localStorage.getItem('optOut') == 'true';
  const isBrowser = localStorage.getItem('isBrowser') == 'true';
  const blacklist = window.sessionStorage.getItem('blacklist') == 'true';
  const exclusionList = window.sessionStorage.getItem('exclusionList') == 'true';

  const stateValid = (identifier: string) =>  {
    const storedState = window.sessionStorage.getItem(`state_${identifier}`);
    window.sessionStorage.removeItem(`state_${identifier}`);
    return storedState == qs.parse(props.location.search).state;
  }

  const renderSuccess = (loading, response, component) => {
    localStorage.setItem('isBrowser', 'false');
    if (response['blacklist']) {
      window.sessionStorage.setItem('token', response['accessToken']);
      window.sessionStorage.setItem('username', response['username']);
      window.sessionStorage.setItem('currentBlacklist', response['blacklist']);
    }
    if (loading) {
      return <Loading/>;
    }
    if (response.ok == false) {
      return <Error response={response}/>;
    }
    return component;
  }
  
  if (blacklist) {
    if (isBrowser) {
      if (!stateValid('blacklist')) {
        setLoading(false);
        setResponse({ ok: false, message: 'State was not maintained, so the request cannot be safely completed. Please try again later.' });
      } else {
        const getTokenAndBlacklist = firebaseFunctions.httpsCallable('getTokenAndBlacklist');
        getTokenAndBlacklist(data).then(r => {
          setResponse(r.data);
          setLoading(false);
        });
      }
    }
    return renderSuccess(loading, response, <Blacklist/>);
  } else if (exclusionList) {
    if (isBrowser) {
      if (!stateValid('exclusion')) {
        setLoading(false);
        setResponse({ ok: false, message: 'State was not maintained, so the request cannot be safely completed. Please try again later.' });
      } else {
        const getTokenAndExclusionList = firebaseFunctions.httpsCallable('getTokenAndExclusionList');
        getTokenAndExclusionList(data).then(r => {
          setSubreddits(r.data['subreddits']);
          setAccessToken(r.data['accessToken']);
          setExclusionSubList(r.data['exclusionList']);
          setResponse(r.data);
          setLoading(false);
        });
      }
    }
    return renderSuccess(loading, response, <SubredditFiltering accessToken={accessToken} subreddits={subreddits} exclusionList={exclusionSubList} />);
  } else {
    if (optOut) {
      if (isBrowser) {
        if (!stateValid('optout')) {
          setLoading(false);
          setResponse({ ok: false, message: 'State was not maintained, so the request cannot be safely completed. Please try again later.' });
        } else {
          const deleteUserInfo = firebaseFunctions.httpsCallable('deleteUserInfo');
          deleteUserInfo(data).then(r => {
            setLoading(false);
            setResponse(r.data);
          });
        }
      }
      return renderSuccess(loading, response, <Optout/>);
    } else {
      if (isBrowser) {
        if (!stateValid('signup')) {
          setLoading(false);
          setResponse({ ok: false, message: 'State was not maintained, so the request cannot be safely completed. Please try again later.' });
        } else {
          const submitUserLogin = firebaseFunctions.httpsCallable('submitUserLogin');
          submitUserLogin(data).then(r => {
            setSubreddits(r.data['subreddits']);
            setAccessToken(r.data['accessToken']);
            setExclusionSubList(r.data['exclusionList']);
            setLoading(false);
            setResponse(r.data);
          });
        }
      }
      return renderSuccess(loading, response, <Optin accessToken={accessToken} subreddits={subreddits} exclusionList={exclusionSubList}/>);
    }
  }
}